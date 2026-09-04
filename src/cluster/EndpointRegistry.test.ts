import { describe, expect, it, vi } from 'vitest';
import { bootstrapEndpoints, EndpointRegistry } from './EndpointRegistry';

describe('EndpointRegistry', () => {
  it('normalizes and deduplicates bootstrap endpoints without losing order', () => {
    expect(bootstrapEndpoints(['http://node-a/', '', '/', ' http://node-b ', 'http://node-a'])).toEqual([
      { id: 'http://node-a', baseUrl: 'http://node-a', source: 'bootstrap' },
      { id: 'http://node-b', baseUrl: 'http://node-b', source: 'bootstrap' },
    ]);
  });

  it('rejects blank same-origin URLs from endpoint advertisements', () => {
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://seed', '']));
    registry.applyAdvertisement([{ nodeId: 'node-a', apiBaseUrls: ['', '/', 'http://node-a'] }]);
    expect(registry.snapshot().map(({ endpoint }) => endpoint.baseUrl)).toEqual(['http://seed', 'http://node-a']);
  });

  it('keeps the last successful endpoint sticky while it remains healthy', () => {
    let now = 1_000;
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']), () => now);
    registry.recordSuccess('http://b');

    expect(registry.candidates().map((candidate) => candidate.endpoint.id)).toEqual(['http://b', 'http://a']);
    now += 100;
    expect(registry.candidates().map((candidate) => candidate.endpoint.id)).toEqual(['http://b', 'http://a']);
  });

  it('moves a failed endpoint behind ready alternatives and makes it eligible after cooldown', () => {
    let now = 1_000;
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']), () => now);
    registry.recordSuccess('http://a');
    registry.recordFailure('http://a');

    expect(registry.candidates().map((candidate) => candidate.endpoint.id)).toEqual(['http://b', 'http://a']);
    now = 1_501;
    expect(registry.candidates(new Set(['http://b'])).map((candidate) => candidate.endpoint.id)).toEqual(['http://a']);
    registry.recordSuccess('http://a');
    expect(registry.candidates().map((candidate) => candidate.endpoint.id)).toEqual(['http://a', 'http://b']);
  });

  it('returns cooling endpoints in earliest-retry order when every endpoint has failed', () => {
    let now = 1_000;
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']), () => now);
    registry.recordFailure('http://a');
    now = 1_100;
    registry.recordFailure('http://b');

    expect(registry.candidates().map((candidate) => candidate.endpoint.id)).toEqual(['http://a', 'http://b']);
  });

  it('supports excluding an endpoint during one failover attempt', () => {
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
    expect(registry.candidates(new Set(['http://a'])).map((candidate) => candidate.endpoint.id)).toEqual(['http://b']);
  });

  it('retains seeds, groups multiple URLs by node, and refreshes discovered endpoints', () => {
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://seed']));

    registry.applyAdvertisement([
      { nodeId: 'node-a', apiBaseUrls: ['http://seed', 'http://node-a-lan'] },
      { nodeId: 'node-b', apiBaseUrls: ['https://node-b.example'] },
    ]);

    expect(registry.snapshot().map(({ endpoint }) => endpoint)).toEqual([
      { id: 'http://seed', baseUrl: 'http://seed', source: 'bootstrap', nodeId: 'node-a' },
      { id: 'http://node-a-lan', baseUrl: 'http://node-a-lan', source: 'discovered', nodeId: 'node-a' },
      { id: 'https://node-b.example', baseUrl: 'https://node-b.example', source: 'discovered', nodeId: 'node-b' },
    ]);

    registry.applyAdvertisement([
      { nodeId: 'node-a', apiBaseUrls: ['http://seed', 'http://node-a-wan'] },
    ]);

    expect(registry.snapshot().map(({ endpoint }) => endpoint)).toEqual([
      { id: 'http://seed', baseUrl: 'http://seed', source: 'bootstrap', nodeId: 'node-a' },
      { id: 'http://node-a-wan', baseUrl: 'http://node-a-wan', source: 'discovered', nodeId: 'node-a' },
    ]);
  });

  it('notifies client-side status observers when endpoint evidence changes', () => {
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a']));
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    registry.recordFailure('http://a');
    registry.recordSuccess('http://a');
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    registry.recordFailure('http://a');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('records probe health without replacing the endpoint preferred by real traffic', () => {
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
    registry.recordSuccess('http://a');
    registry.recordProbeSuccess('http://b');

    expect(registry.candidates().map(({ endpoint }) => endpoint.id)).toEqual(['http://a', 'http://b']);
    expect(registry.snapshot().find(({ endpoint }) => endpoint.id === 'http://b')?.health.lastSuccessAt).toBeDefined();
  });

  it('lets a probe-failed preferred endpoint resume authority once its cooldown lapses, unlike a real failure', () => {
    let now = 1_000;
    const preferredAfterRealFailure = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']), () => now);
    preferredAfterRealFailure.recordSuccess('http://a');
    preferredAfterRealFailure.recordFailure('http://a');
    now = 1_501;
    // A genuine failure permanently gives up authority: once ready again, the
    // never-failed alternative outranks it on failure count, not insertion.
    expect(preferredAfterRealFailure.candidates()[0]?.endpoint.id).toBe('http://b');

    now = 1_000;
    const preferredAfterProbeFailure = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']), () => now);
    preferredAfterProbeFailure.recordSuccess('http://a');
    preferredAfterProbeFailure.recordProbeFailure('http://a');
    // Still cooling down: a ready alternative is tried first either way.
    expect(preferredAfterProbeFailure.candidates()[0]?.endpoint.id).toBe('http://b');
    now = 1_501;
    // But a mere probe blip must not have surrendered authority: once its
    // cooldown lapses, the endpoint real traffic preferred resumes first.
    expect(preferredAfterProbeFailure.candidates()[0]?.endpoint.id).toBe('http://a');
  });

  describe('latency-based pre-emptive authority swap', () => {
    it('does nothing without a sustained-advantage streak across consecutive cycles', () => {
      const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
      registry.recordSuccess('http://a');
      registry.recordLatency('http://a', 500);
      registry.recordLatency('http://b', 50);

      expect(registry.evaluateLatencySwap()).toBeUndefined();
      expect(registry.evaluateLatencySwap()).toBeUndefined();
      expect(registry.candidates()[0]?.endpoint.id).toBe('http://a');
    });

    it('moves authority once the same alternate stays materially faster for three consecutive cycles', () => {
      const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
      registry.recordSuccess('http://a');
      registry.recordLatency('http://a', 500);
      registry.recordLatency('http://b', 50);

      expect(registry.evaluateLatencySwap()).toBeUndefined();
      expect(registry.evaluateLatencySwap()).toBeUndefined();
      expect(registry.evaluateLatencySwap()).toEqual({
        fromId: 'http://a', toId: 'http://b', fromLatencyMs: 500, toLatencyMs: 50,
      });
      expect(registry.candidates()[0]?.endpoint.id).toBe('http://b');
    });

    it('never swaps for an improvement below the absolute or relative threshold', () => {
      const belowAbsolute = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
      belowAbsolute.recordSuccess('http://a');
      belowAbsolute.recordLatency('http://a', 100);
      belowAbsolute.recordLatency('http://b', 1); // >60% faster but well under the 200ms absolute floor
      for (let cycle = 0; cycle < 5; cycle += 1) expect(belowAbsolute.evaluateLatencySwap()).toBeUndefined();

      const belowRelative = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
      belowRelative.recordSuccess('http://a');
      belowRelative.recordLatency('http://a', 1_000);
      belowRelative.recordLatency('http://b', 850); // 150ms + 15% faster: neither bar cleared
      for (let cycle = 0; cycle < 5; cycle += 1) expect(belowRelative.evaluateLatencySwap()).toBeUndefined();
    });

    it('resets the advantage streak when the faster candidate changes cycle to cycle', () => {
      const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b', 'http://c']));
      registry.recordSuccess('http://a');
      registry.recordLatency('http://a', 500);
      registry.recordLatency('http://b', 50);
      expect(registry.evaluateLatencySwap()).toBeUndefined();

      registry.recordLatency('http://c', 50);
      // A different endpoint takes the "fastest" slot this cycle; the streak must restart.
      registry.recordLatency('http://b', 500);
      expect(registry.evaluateLatencySwap()).toBeUndefined();
      expect(registry.evaluateLatencySwap()).toBeUndefined();
      expect(registry.evaluateLatencySwap()).toBeDefined();
    });

    it('ignores a fast alternate that is still cooling down from a recent failure', () => {
      let now = 1_000;
      const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']), () => now);
      registry.recordSuccess('http://a');
      registry.recordFailure('http://b');
      registry.recordLatency('http://a', 500);
      registry.recordLatency('http://b', 50);

      for (let cycle = 0; cycle < 5; cycle += 1) expect(registry.evaluateLatencySwap(now)).toBeUndefined();
      now = 1_501; // http://b's cooldown lapses
      expect(registry.evaluateLatencySwap(now)).toBeUndefined();
      expect(registry.evaluateLatencySwap(now)).toBeUndefined();
      expect(registry.evaluateLatencySwap(now)).toEqual({
        fromId: 'http://a', toId: 'http://b', fromLatencyMs: 500, toLatencyMs: 50,
      });
    });

    it('will not swap again until the cooldown after a swap lapses', () => {
      let now = 1_000;
      const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b', 'http://c']), () => now);
      registry.recordSuccess('http://a');
      registry.recordLatency('http://a', 1_000);
      registry.recordLatency('http://b', 500);
      for (let cycle = 0; cycle < 2; cycle += 1) registry.evaluateLatencySwap(now);
      expect(registry.evaluateLatencySwap(now)).toEqual(expect.objectContaining({ toId: 'http://b' }));

      // http://c now looks even faster than the newly preferred http://b, but
      // the post-swap cooldown must hold regardless of streak length.
      registry.recordLatency('http://c', 200);
      for (let cycle = 0; cycle < 5; cycle += 1) expect(registry.evaluateLatencySwap(now)).toBeUndefined();

      now += 60_000; // the post-swap cooldown
      for (let cycle = 0; cycle < 2; cycle += 1) expect(registry.evaluateLatencySwap(now)).toBeUndefined();
      expect(registry.evaluateLatencySwap(now)).toEqual(expect.objectContaining({ fromId: 'http://b', toId: 'http://c' }));
    });

    it('never swaps before the preferred endpoint has its own latency sample', () => {
      const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
      registry.recordSuccess('http://a');
      registry.recordLatency('http://b', 50);

      for (let cycle = 0; cycle < 5; cycle += 1) expect(registry.evaluateLatencySwap()).toBeUndefined();
    });

    it('averages latency over a bounded rolling window', () => {
      const registry = new EndpointRegistry(bootstrapEndpoints(['http://a']));
      for (const sample of [100, 100, 100, 100, 100, 500]) registry.recordLatency('http://a', sample);
      // The oldest 100ms sample has rolled off a five-sample window.
      expect(registry.latencyMs('http://a')).toBe((100 + 100 + 100 + 100 + 500) / 5);
    });
  });
});
