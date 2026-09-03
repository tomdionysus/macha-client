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

    await expect(probeKnownEndpoints(registry, 'secret', new AbortController().signal, fetchImpl)).resolves.toBe(2);

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
    let finish!: (response: Response) => void;
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeUndefined();
      return new Promise<Response>((resolve) => { finish = resolve; });
    }) as typeof fetch;

    const probe = probeKnownEndpoints(registry, undefined, controller.signal, fetchImpl);
    controller.abort();
    finish(new Response(null, { status: 200 }));
    await probe;

    expect(registry.snapshot()[0]?.health).toEqual({ consecutiveFailures: 0 });
  });

  it('never attaches lifecycle cancellation to status HTTP requests', async () => {
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a']));
    const lifecycle = new AbortController();
    let finish!: (response: Response) => void;
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeUndefined();
      return new Promise<Response>((resolve) => { finish = resolve; });
    }) as typeof fetch;

    const probe = probeKnownEndpoints(registry, undefined, lifecycle.signal, fetchImpl);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(registry.snapshot()[0]?.health).toEqual({ consecutiveFailures: 0 });
    finish(new Response(null, { status: 200 }));

    await expect(probe).resolves.toBe(1);
    expect(registry.snapshot()[0]?.health.consecutiveFailures).toBe(0);
  });
});
