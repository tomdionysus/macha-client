import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapEndpoints, EndpointRegistry } from './EndpointRegistry';
import { probeKnownEndpoints } from './useEndpointHealthMonitor';
import { clearClientDiagnostics, clientDiagnosticsSnapshot, configureClientDiagnostics } from '../diagnostics/ClientLog';

describe('API endpoint health probes', () => {
  beforeEach(() => {
    clearClientDiagnostics();
    configureClientDiagnostics({ level: 'debug', console: false, maxEntries: 100 });
  });

  it('records a reachable/known summary to bounded diagnostics each cycle', async () => {
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
    const fetchImpl = vi.fn(async (url: string | URL | Request) => new Response(null, {
      status: String(url).startsWith('http://a/') ? 200 : 503,
    })) as unknown as typeof fetch;

    await probeKnownEndpoints(registry, undefined, new AbortController().signal, fetchImpl);

    const entry = clientDiagnosticsSnapshot().find((candidate) => candidate.scope === 'cluster.health');
    expect(entry).toMatchObject({ event: 'probe-cycle', data: { reachable: 2, known: 2 } });
  });

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

  it('does not let a failed background probe permanently give up the endpoint preferred by real traffic', async () => {
    let now = 1_000;
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']), () => now);
    registry.recordSuccess('http://a');
    const fetchImpl = vi.fn(async (url: string | URL | Request) => new Response(null, {
      status: String(url).startsWith('http://a/') ? 503 : 200,
    })) as unknown as typeof fetch;

    await probeKnownEndpoints(registry, undefined, new AbortController().signal, fetchImpl);
    // Still cooling down from the probe failure: a ready alternative sorts first.
    expect(registry.candidates()[0]?.endpoint.id).toBe('http://b');

    now = 1_501;
    // Once the cooldown lapses, the endpoint real traffic preferred resumes
    // authority rather than staying displaced by a mere probe blip.
    expect(registry.candidates()[0]?.endpoint.id).toBe('http://a');
  });

  it('records observed latency from a successful probe and logs a reported pre-emptive swap', async () => {
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a']));
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_500);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const recordLatencySpy = vi.spyOn(registry, 'recordLatency');
    vi.spyOn(registry, 'evaluateLatencySwap').mockReturnValue({
      fromId: 'http://a', toId: 'http://b', fromLatencyMs: 500, toLatencyMs: 50,
    });

    await probeKnownEndpoints(registry, undefined, new AbortController().signal, fetchImpl);
    nowSpy.mockRestore();

    expect(recordLatencySpy).toHaveBeenCalledWith('http://a', 500);
    const entry = clientDiagnosticsSnapshot().find((candidate) => candidate.event === 'latency-preemptive-swap');
    expect(entry).toMatchObject({ scope: 'cluster.health', data: { fromId: 'http://a', toId: 'http://b' } });
  });

  it('does not record latency for a reachable-but-non-ok response', async () => {
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a']));
    const recordLatencySpy = vi.spyOn(registry, 'recordLatency');
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch;

    await probeKnownEndpoints(registry, undefined, new AbortController().signal, fetchImpl);

    expect(recordLatencySpy).not.toHaveBeenCalled();
    expect(registry.latencyMs('http://a')).toBeUndefined();
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
