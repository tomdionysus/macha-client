import { useEffect } from 'react';
import { mergeRequestHeaders } from '../api/httpCompat';
import { NO_AUTH, type AuthenticatedFetch } from '../api/SessionManager';
import type { ClusterStatusApi } from '../api/ClusterStatusApi';
import type { EndpointRegistry, MachaEndpoint } from './EndpointRegistry';
import { reportClusterReachable, reportClusterUnreachable } from '../api/serverConnection';
import { createClientLogger } from '../diagnostics/ClientLog';

export const ENDPOINT_HEALTH_INTERVAL_MS = 10_000;

const log = createClientLogger('cluster.health');

interface ProbeResult {
  status: 'healthy' | 'reachable' | 'unreachable';
  /** Round-trip time for a genuinely successful response only. */
  latencyMs?: number;
}

async function probeEndpoint(endpoint: MachaEndpoint, auth: AuthenticatedFetch): Promise<ProbeResult> {
  const startedAt = performance.now();
  try {
    const response = await auth.fetch(`${endpoint.baseUrl}/api/v1/catalogue/status`, {
      method: 'GET',
      headers: mergeRequestHeaders(undefined, { Accept: 'application/json' }),
      cache: 'no-store',
    });
    if (!response.ok) return { status: 'reachable' };
    return { status: 'healthy', latencyMs: performance.now() - startedAt };
  } catch {
    return { status: 'unreachable' };
  }
}

/**
 * Learn live cluster membership from whichever known endpoint answers and
 * merge it into the registry. This is how failover candidates reach beyond
 * the single endpoint a user happens to have typed in: the cluster already
 * reports every online node's host/port on this same status call, so the
 * playback failover pool tracks real membership instead of staying frozen
 * at bootstrap configuration.
 */
export async function discoverClusterEndpoints(
  registry: EndpointRegistry,
  clusterStatusApi: ClusterStatusApi,
): Promise<void> {
  try {
    const { nodes } = await clusterStatusApi.status();
    // `host`/`port` is the node's internal RPC bind address, not its HTTP API
    // — using it here would guess at a port that is frequently wrong (a
    // different service, or unreachable behind NAT). Only `api_host`/
    // `api_port`, which the server advertises specifically for this purpose,
    // are trustworthy; nodes not yet reporting it are simply not discovered.
    const advertisements = nodes
      .filter((node) => node.state === 'online' && node.api_host && node.api_port)
      .map((node) => ({ nodeId: node.id, apiBaseUrls: [`http://${node.api_host}:${node.api_port}`] }));
    if (advertisements.length > 0) registry.applyAdvertisement(advertisements);
  } catch {
    // Membership discovery is opportunistic. Health probing of already-known
    // endpoints must keep working even when no endpoint can answer this yet.
  }
}

/** Probe every currently known HTTP API endpoint once, in parallel. */
export async function probeKnownEndpoints(
  registry: EndpointRegistry,
  auth: AuthenticatedFetch,
  signal: AbortSignal,
): Promise<number> {
  const endpoints = registry.snapshot().map(({ endpoint }) => endpoint);
  let reachable = 0;
  await Promise.all(endpoints.map(async (endpoint) => {
    // The lifecycle signal governs whether this result is still publishable;
    // it must never be attached to the HTTP request. Cancelling one React
    // consumer (or a playback request) is not evidence about node health.
    const result = await probeEndpoint(endpoint, auth);
    if (signal.aborted) return;
    if (result.status !== 'unreachable') reachable += 1;
    if (result.status === 'healthy') {
      registry.recordProbeSuccess(endpoint.id);
      if (result.latencyMs !== undefined) registry.recordLatency(endpoint.id, result.latencyMs);
    } else {
      registry.recordProbeFailure(endpoint.id);
    }
  }));
  if (!signal.aborted) {
    const swap = registry.evaluateLatencySwap();
    if (swap) {
      log.info('latency-preemptive-swap', swap);
    }
    log.debug('probe-cycle', { reachable, known: endpoints.length });
  }
  return reachable;
}

/** Application-wide, bounded health loop. It owns no server or playback state. */
export function useEndpointHealthMonitor(
  registry: EndpointRegistry,
  clusterStatusApi: ClusterStatusApi,
  auth: AuthenticatedFetch = NO_AUTH,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cycle = async () => {
      await discoverClusterEndpoints(registry, clusterStatusApi);
      if (controller.signal.aborted) return;
      const reachable = await probeKnownEndpoints(registry, auth, controller.signal);
      if (!controller.signal.aborted && registry.snapshot().length > 0) {
        if (reachable > 0) reportClusterReachable(); else reportClusterUnreachable();
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void cycle(), ENDPOINT_HEALTH_INTERVAL_MS);
    };
    void cycle();

    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [auth, clusterStatusApi, enabled, registry]);
}
