import { createClientLogger } from '@machafoundation/core';
import type { PlaybackSource } from '@machafoundation/core';

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
  /** Cumulative milliseconds spent transferring; with `fetchedBytes`, throughput excluding idle time. */
  fetchActiveMs: number;
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

interface ReadAheadFailureMessage {
  type: 'macha-direct-read-ahead-source-failed';
  sourceKey: string;
  sourceUrl?: string;
  message?: string;
  /**
   * The HTTP status that failed the source; absent for a transport failure. A `404` is the
   * node declining this source, not being unwell, so a reaped session is re-created rather
   * than failed over.
   */
  status?: number;
}

/** A read-ahead failure; `status` is set only when a response was reached. */
export interface DirectPlayReadAheadError extends Error {
  status?: number;
}

const log = createClientLogger('playback.readahead');
const WORKER_FILE = 'macha-direct-play-sw.js';
const PROXY_PATH = '__macha_direct_cache__';
const metricsBySource = new Map<string, DirectPlayReadAheadMetrics>();
const keyBySource = new Map<string, string>();
const sourceByKey = new Map<string, string>();
const failureListenersBySource = new Map<string, Set<(error: DirectPlayReadAheadError) => void>>();
/** Last counters seen per source, so each message contributes only new bytes. */
const lastTransferBySource = new Map<string, { fetchedBytes: number; fetchActiveMs: number }>();
let transferListener: MediaTransferListener | undefined;
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
    candidate.fetchActiveMs,
  ];
  return numbers.every((number) => typeof number === 'number' && Number.isFinite(number) && number >= 0)
    && typeof candidate.sourceOrigin === 'string'
    && (candidate.mode === 'bootstrap' || candidate.mode === 'playing' || candidate.mode === 'seeking' || candidate.mode === 'paused');
}

function installMessageListener(): void {
  if (messageListenerInstalled || !serviceWorkerAvailable()) return;
  messageListenerInstalled = true;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
    const message = event.data as Partial<ReadAheadMetricsMessage | ReadAheadFailureMessage> | undefined;
    if (message?.type === 'macha-direct-read-ahead-source-failed' && typeof message.sourceKey === 'string') {
      const failure = message as Partial<ReadAheadFailureMessage>;
      const sourceUrl = sourceByKey.get(message.sourceKey);
      if (!sourceUrl) return;
      const error: DirectPlayReadAheadError = new Error(
        failure.message || `Direct Play read-ahead failed for ${failure.sourceUrl || sourceUrl}`,
      );
      if (typeof failure.status === 'number') error.status = failure.status;
      log.warn('source-degraded', { sourceUrl, failedSourceUrl: failure.sourceUrl, status: failure.status, error });
      for (const listener of failureListenersBySource.get(sourceUrl) ?? []) listener(error);
      return;
    }
    if (message?.type !== 'macha-direct-read-ahead-metrics'
        || typeof message.sourceKey !== 'string'
        || !validMetrics(message.metrics)) return;
    const sourceUrl = sourceByKey.get(message.sourceKey);
    if (!sourceUrl) return;
    metricsBySource.set(sourceUrl, message.metrics);
    reportTransfer(sourceUrl, message.metrics);
    log.debug('metrics', { sourceUrl, ...message.metrics });
  });
}

/** Real media bytes moved, and the node that served them. */
export type MediaTransferListener = (origin: string, bytes: number, durationMs: number) => void;

/**
 * Reports media throughput for endpoint ranking, which otherwise sees only JSON payloads.
 * Injected so playback does not import cluster code.
 */
export function setMediaTransferListener(listener: MediaTransferListener | undefined): void {
  transferListener = listener;
  if (!listener) lastTransferBySource.clear();
}

/**
 * One hls.js fragment, reported through the same listener as Direct Play. Timed from first
 * byte to last: the wait before the first byte is the node deciding, not the link.
 */
export function reportFragmentTransfer(url: string, bytes: number, firstByteAtMs: number, endAtMs: number): void {
  if (!transferListener || !(bytes > 0)) return;
  const durationMs = endAtMs - firstByteAtMs;
  if (!(durationMs > 0)) return;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return;
  }
  transferListener(origin, bytes, Math.round(durationMs * 10) / 10);
}

function reportTransfer(sourceUrl: string, metrics: DirectPlayReadAheadMetrics): void {
  const previous = lastTransferBySource.get(sourceUrl);
  lastTransferBySource.set(sourceUrl, { fetchedBytes: metrics.fetchedBytes, fetchActiveMs: metrics.fetchActiveMs });
  if (!transferListener || !metrics.sourceOrigin || !previous) return;
  const bytes = metrics.fetchedBytes - previous.fetchedBytes;
  const durationMs = metrics.fetchActiveMs - previous.fetchActiveMs;
  // Non-positive: an idle window, or the worker resetting its counters. The baseline has already advanced.
  if (bytes <= 0 || durationMs <= 0) return;
  transferListener(metrics.sourceOrigin, bytes, durationMs);
}

/** How long to wait for the worker's answer. */
const SOURCE_STATUS_TIMEOUT_MS = 1_000;

/**
 * The failure status the node last answered the worker for this source, if any. For an
 * element that errors before the worker's report arrives: the worker records the status first.
 */
export function directPlayReadAheadSourceStatus(sourceUrl: string | undefined): Promise<number | undefined> {
  const sourceKey = sourceUrl ? keyBySource.get(sourceUrl) : undefined;
  const controller = serviceWorkerAvailable() ? navigator.serviceWorker.controller : null;
  if (!sourceKey || !controller) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(undefined);
    }, SOURCE_STATUS_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent<{ status?: unknown }>) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(typeof event.data?.status === 'number' ? event.data.status : undefined);
    };
    controller.postMessage({ type: 'macha-direct-read-ahead-status', sourceKey }, [channel.port2]);
  });
}

export function subscribeDirectPlayReadAheadFailure(
  sourceUrl: string,
  listener: (error: DirectPlayReadAheadError) => void,
): () => void {
  installMessageListener();
  let listeners = failureListenersBySource.get(sourceUrl);
  if (!listeners) {
    listeners = new Set();
    failureListenersBySource.set(sourceUrl, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) failureListenersBySource.delete(sourceUrl);
  };
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
  // The URL describes the source itself, so demand never waits on the configure message.
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
  // Fire-and-forget: the proxy URL is self-describing.
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

/** Registers the worker at boot without delaying mount. */
export function warmDirectPlayReadAhead(): void {
  if (!serviceWorkerAvailable()) return;
  void ensureRegistration().catch(() => undefined);
}

/** The read-ahead proxy URL when a Service Worker already controls the page, else the source's own. Nothing is awaited. */
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
  failureListenersBySource.delete(sourceUrl);
  lastTransferBySource.delete(sourceUrl);
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
