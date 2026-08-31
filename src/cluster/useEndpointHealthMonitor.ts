import { useEffect } from 'react';
import { authenticatedRequestHeaders } from '../api/httpCompat';
import type { EndpointRegistry, MachaEndpoint } from './EndpointRegistry';

export const ENDPOINT_HEALTH_INTERVAL_MS = 10_000;
export const ENDPOINT_HEALTH_TIMEOUT_MS = 3_000;

type Fetch = typeof fetch;

async function probeEndpoint(
  endpoint: MachaEndpoint,
  bearerToken: string | undefined,
  parentSignal: AbortSignal,
  fetchImpl: Fetch,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchImpl(`${endpoint.baseUrl}/api/v1/catalogue/status`, {
      method: 'GET',
      headers: authenticatedRequestHeaders(undefined, bearerToken, { Accept: 'application/json' }),
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    parentSignal.removeEventListener('abort', abort);
  }
}

/** Probe every currently known HTTP API endpoint once, in parallel. */
export async function probeKnownEndpoints(
  registry: EndpointRegistry,
  bearerToken: string | undefined,
  signal: AbortSignal,
  fetchImpl: Fetch = fetch,
  timeoutMs = ENDPOINT_HEALTH_TIMEOUT_MS,
): Promise<void> {
  const endpoints = registry.snapshot().map(({ endpoint }) => endpoint);
  await Promise.all(endpoints.map(async (endpoint) => {
    const healthy = await probeEndpoint(endpoint, bearerToken, signal, fetchImpl, timeoutMs);
    if (signal.aborted) return;
    if (healthy) registry.recordProbeSuccess(endpoint.id);
    else registry.recordFailure(endpoint.id);
  }));
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
      await probeKnownEndpoints(registry, bearerToken, controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(() => void cycle(), ENDPOINT_HEALTH_INTERVAL_MS);
    };
    void cycle();

    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [bearerToken, enabled, registry]);
}
