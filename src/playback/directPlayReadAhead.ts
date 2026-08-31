import { createClientLogger } from '../diagnostics/ClientLog';
import type { PlaybackSource } from '../types';

export type DirectPlayReadAheadMode = 'bootstrap' | 'playing' | 'seeking' | 'paused';

export interface DirectPlayReadAheadMetrics {
  /** Query/credential-free origin currently preferred by the worker. */
  sourceOrigin: string;
  fetchedBytes: number;
  servedBytes: number;
  cacheHitBytes: number;
  residentBytes: number;
  aheadBytes: number;
  activeFetches: number;
  peakFetches: number;
  lastFetchMbps: number;
  demandWaitCount: number;
  demandWaitMs: number;
  demandFetches: number;
  demandBytes: number;
  demandFirstByteMs: number;
  demandBlockedByPrefetchMs: number;
  prefetchFetches: number;
  prefetchBytes: number;
  prefetchAbortsForDemand: number;
  generation: number;
  mode: DirectPlayReadAheadMode;
}

interface ReadAheadMetricsMessage {
  type: 'macha-direct-read-ahead-metrics';
  sourceKey: string;
  metrics: DirectPlayReadAheadMetrics;
}

const log = createClientLogger('playback.readahead');
const WORKER_FILE = 'macha-direct-play-sw.js';
const PROXY_PATH = '__macha_direct_cache__';
const metricsBySource = new Map<string, DirectPlayReadAheadMetrics>();
const keyBySource = new Map<string, string>();
const sourceByKey = new Map<string, string>();
let registrationPromise: Promise<ServiceWorkerRegistration | undefined> | undefined;
let messageListenerInstalled = false;

function serviceWorkerAvailable(): boolean {
  return typeof window !== 'undefined'
    && window.isSecureContext
    && typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator;
}

function baseUrl(): URL {
  return new URL(import.meta.env.BASE_URL || '/', window.location.origin);
}

function workerUrl(): string {
  return new URL(WORKER_FILE, baseUrl()).toString();
}

function workerScope(): string {
  return baseUrl().pathname;
}

function proxyBaseUrl(): URL {
  return new URL(PROXY_PATH, baseUrl().toString().replace(/\/?$/, '/'));
}

function validMetrics(value: unknown): value is DirectPlayReadAheadMetrics {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DirectPlayReadAheadMetrics>;
  const numbers = [
    candidate.fetchedBytes,
    candidate.servedBytes,
    candidate.cacheHitBytes,
    candidate.residentBytes,
    candidate.aheadBytes,
    candidate.activeFetches,
    candidate.peakFetches,
    candidate.lastFetchMbps,
    candidate.demandWaitCount,
    candidate.demandWaitMs,
    candidate.demandFetches,
    candidate.demandBytes,
    candidate.demandFirstByteMs,
    candidate.demandBlockedByPrefetchMs,
    candidate.prefetchFetches,
    candidate.prefetchBytes,
    candidate.prefetchAbortsForDemand,
    candidate.generation,
  ];
  return numbers.every((number) => typeof number === 'number' && Number.isFinite(number) && number >= 0)
    && typeof candidate.sourceOrigin === 'string'
    && (candidate.mode === 'bootstrap' || candidate.mode === 'playing' || candidate.mode === 'seeking' || candidate.mode === 'paused');
}

function installMessageListener(): void {
  if (messageListenerInstalled || !serviceWorkerAvailable()) return;
  messageListenerInstalled = true;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
    const message = event.data as Partial<ReadAheadMetricsMessage> | undefined;
    if (message?.type !== 'macha-direct-read-ahead-metrics'
        || typeof message.sourceKey !== 'string'
        || !validMetrics(message.metrics)) return;
    const sourceUrl = sourceByKey.get(message.sourceKey);
    if (!sourceUrl) return;
    metricsBySource.set(sourceUrl, message.metrics);
    log.debug('metrics', { sourceUrl, ...message.metrics });
  });
}


async function ensureRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!serviceWorkerAvailable()) return undefined;
  installMessageListener();
  if (!registrationPromise) {
    registrationPromise = (async () => {
      try {
        const registration = await navigator.serviceWorker.register(workerUrl(), {
          scope: workerScope(),
          updateViaCache: 'none',
        });
        log.info('worker-registered', { scope: registration.scope });
        return registration;
      } catch (error) {
        log.warn('worker-registration-failed', { error });
        return undefined;
      }
    })();
  }
  return registrationPromise;
}

function newSourceKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function buildDirectPlayReadAheadProxyUrl(
  sourceKey: string,
  origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
  source?: PlaybackSource,
): string {
  const proxy = typeof window !== 'undefined'
    ? proxyBaseUrl()
    : new URL(`/${PROXY_PATH}`, origin);
  proxy.searchParams.set('key', sourceKey);
  // Self-describe the proxy request so a fetch can never wait for Service Worker
  // message ordering. The configure message still establishes mode/metrics state,
  // but demand has everything it needs in the URL and can start immediately.
  if (source?.sizeBytes && source.sizeBytes > 0) {
    proxy.searchParams.set('source', source.url);
    proxy.searchParams.set('size', String(Math.floor(source.sizeBytes)));
    proxy.searchParams.set('mime', source.mimeType ?? 'application/octet-stream');
  }
  return proxy.toString();
}

function eligible(source: PlaybackSource, origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'): boolean {
  if (source.mode !== 'direct' || !source.sizeBytes || source.sizeBytes <= 0) return false;
  try {
    const target = new URL(source.url, origin);
    return target.protocol === 'http:' || target.protocol === 'https:';
  } catch {
    return false;
  }
}

function configureSource(activeController: ServiceWorker, source: PlaybackSource): string {
  const existing = keyBySource.get(source.url);
  if (existing) return existing;
  const sourceKey = newSourceKey();
  // Configuration is intentionally fire-and-forget. The proxy URL itself is
  // self-describing, so Service Worker message ordering can never delay demand.
  keyBySource.set(source.url, sourceKey);
  sourceByKey.set(sourceKey, source.url);
  activeController.postMessage({
    type: 'macha-direct-read-ahead-configure',
    sourceKey,
    sourceUrl: source.url,
    sizeBytes: Math.floor(source.sizeBytes ?? 0),
    mimeType: source.mimeType ?? 'application/octet-stream',
  });
  return sourceKey;
}

/** Warm the worker during application boot. This never delays application mount. */
export function warmDirectPlayReadAhead(): void {
  if (!serviceWorkerAvailable()) return;
  void ensureRegistration().catch(() => undefined);
}

/**
 * Return a read-ahead proxy only when a Service Worker already controls this
 * page. Registration/configuration are never awaited by playback; first use
 * simply falls back to the native source if the optional cache is not ready.
 */
export function directPlayReadAheadUrl(source: PlaybackSource): string {
  if (!eligible(source) || !serviceWorkerAvailable()) return source.url;
  installMessageListener();
  const activeController = navigator.serviceWorker.controller;
  if (!activeController) {
    void ensureRegistration();
    log.debug('worker-not-ready-native-path', { sourceUrl: source.url });
    return source.url;
  }
  const sourceKey = configureSource(activeController, source);
  log.info('enabled', {
    sourceUrl: source.url,
    sourceKey,
    sizeBytes: source.sizeBytes,
  });
  return buildDirectPlayReadAheadProxyUrl(sourceKey, window.location.origin, source);
}

/** Add an already-negotiated equivalent URL to the active worker source set. */
export function addDirectPlayReadAheadAlternative(activeSource: PlaybackSource, alternative: PlaybackSource): boolean {
  if (!eligible(alternative) || !serviceWorkerAvailable()) return false;
  const sourceKey = keyBySource.get(activeSource.url);
  const activeController = navigator.serviceWorker.controller;
  if (!sourceKey || !activeController) return false;
  activeController.postMessage({
    type: 'macha-direct-read-ahead-add-source',
    sourceKey,
    sourceUrl: alternative.url,
  });
  log.info('alternate-added', { sourceKey, sourceUrl: alternative.url });
  return true;
}

export function setDirectPlayReadAheadMode(sourceUrl: string | undefined, mode: DirectPlayReadAheadMode): void {
  if (!sourceUrl) return;
  const sourceKey = keyBySource.get(sourceUrl);
  if (!sourceKey || !serviceWorkerAvailable()) return;
  navigator.serviceWorker.controller?.postMessage({
    type: 'macha-direct-read-ahead-state',
    sourceKey,
    mode,
  });
}

export function releaseDirectPlayReadAhead(sourceUrl: string | undefined): void {
  if (!sourceUrl) return;
  metricsBySource.delete(sourceUrl);
  const sourceKey = keyBySource.get(sourceUrl);
  if (!sourceKey) return;
  keyBySource.delete(sourceUrl);
  sourceByKey.delete(sourceKey);
  if (!serviceWorkerAvailable()) return;
  navigator.serviceWorker.controller?.postMessage({
    type: 'macha-direct-read-ahead-release',
    sourceKey,
  });
}

export function directPlayReadAheadMetrics(sourceUrl: string | undefined): DirectPlayReadAheadMetrics | undefined {
  if (!sourceUrl) return undefined;
  const metrics = metricsBySource.get(sourceUrl);
  return metrics ? { ...metrics } : undefined;
}

export function installDirectPlayReadAheadDiagnostics(): void {
  if (typeof window === 'undefined') return;
  window.machaDirectPlayReadAhead = {
    snapshot(): Record<string, DirectPlayReadAheadMetrics> {
      return Object.fromEntries([...sourceByKey.entries()].flatMap(([sourceKey, sourceUrl]) => {
        const metrics = metricsBySource.get(sourceUrl);
        return metrics ? [[sourceKey, { ...metrics }]] : [];
      }));
    },
  };
}

declare global {
  interface Window {
    machaDirectPlayReadAhead?: {
      snapshot(): Record<string, DirectPlayReadAheadMetrics>;
    };
  }
}
