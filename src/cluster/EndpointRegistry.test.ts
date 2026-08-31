import { describe, expect, it, vi } from 'vitest';
import { bootstrapEndpoints, EndpointRegistry } from './EndpointRegistry';

describe('EndpointRegistry', () => {
  it('normalizes and deduplicates bootstrap endpoints without losing order', () => {
    expect(bootstrapEndpoints(['http://node-a/', ' http://node-b ', 'http://node-a'])).toEqual([
      { id: 'http://node-a', baseUrl: 'http://node-a', source: 'bootstrap' },
      { id: 'http://node-b', baseUrl: 'http://node-b', source: 'bootstrap' },
    ]);
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
});
