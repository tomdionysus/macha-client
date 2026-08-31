import { describe, expect, it, vi } from 'vitest';
import { bootstrapEndpoints, EndpointRegistry } from './EndpointRegistry';
import { probeKnownEndpoints } from './useEndpointHealthMonitor';

describe('API endpoint health probes', () => {
  it('tries every known endpoint and records usable API health', async () => {
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
    registry.recordSuccess('http://a');
    const fetchSpy = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => new Response(null, {
      status: String(url).startsWith('http://a/') ? 200 : 503,
    }));
    const fetchImpl = fetchSpy as unknown as typeof fetch;

    await probeKnownEndpoints(registry, 'secret', new AbortController().signal, fetchImpl);

    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      'http://a/api/v1/catalogue/status',
      'http://b/api/v1/catalogue/status',
    ]);
    expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer secret');
    expect(registry.snapshot().map(({ health }) => health.consecutiveFailures)).toEqual([0, 1]);
    expect(registry.candidates()[0]?.endpoint.id).toBe('http://a');
  });

  it('does not publish results after the monitor is cancelled', async () => {
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a']));
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort();
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    await probeKnownEndpoints(registry, undefined, controller.signal, fetchImpl);

    expect(registry.snapshot()[0]?.health).toEqual({ consecutiveFailures: 0 });
  });
});
