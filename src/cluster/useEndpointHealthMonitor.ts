import { useEffect } from 'react';
import { authenticatedRequestHeaders } from '../api/httpCompat';
import type { EndpointRegistry, MachaEndpoint } from './EndpointRegistry';
import { reportClusterReachable, reportClusterUnreachable } from '../api/serverConnection';
import { createClientLogger } from '../diagnostics/ClientLog';

export const ENDPOINT_HEALTH_INTERVAL_MS = 10_000;

const log = createClientLogger('cluster.health');

type Fetch = typeof fetch;

interface ProbeResult {
  status: 'healthy' | 'reachable' | 'unreachable';
  /** Round-trip time for a genuinely successful response only. */
  latencyMs?: number;
}

async function probeEndpoint(
  endpoint: MachaEndpoint,
  bearerToken: string | undefined,
  fetchImpl: Fetch,
): Promise<ProbeResult> {
  const startedAt = performance.now();
  try {
    const response = await fetchImpl(`${endpoint.baseUrl}/api/v1/catalogue/status`, {
      method: 'GET',
      headers: authenticatedRequestHeaders(undefined, bearerToken, { Accept: 'application/json' }),
      cache: 'no-store',
    });
    if (!response.ok) return { status: 'reachable' };
    return { status: 'healthy', latencyMs: performance.now() - startedAt };
  } catch {
    return { status: 'unreachable' };
  }
}

/** Probe every currently known HTTP API endpoint once, in parallel. */
export async function probeKnownEndpoints(
  registry: EndpointRegistry,
  bearerToken: string | undefined,
  signal: AbortSignal,
  fetchImpl: Fetch = fetch,
): Promise<number> {
  const endpoints = registry.snapshot().map(({ endpoint }) => endpoint);
  let reachable = 0;
  await Promise.all(endpoints.map(async (endpoint) => {
    // The lifecycle signal governs whether this result is still publishable;
    // it must never be attached to the HTTP request. Cancelling one React
    // consumer (or a playback request) is not evidence about node health.
    const result = await probeEndpoint(endpoint, bearerToken, fetchImpl);
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
  bearerToken: string | undefined,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cycle = async () => {
      const reachable = await probeKnownEndpoints(registry, bearerToken, controller.signal);
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
  }, [bearerToken, enabled, registry]);
}
