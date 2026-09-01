import { describe, expect, it, vi } from 'vitest';
import { bootstrapEndpoints, EndpointRegistry } from './EndpointRegistry';
import { ClusterEndpointRouter } from './endpointRouting';

describe('ClusterEndpointRouter', () => {
  it('makes the first working alternative authoritative without letting probes steal authority', async () => {
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
    const router = new ClusterEndpointRouter(registry);
    const first = vi.fn(async (endpoint: { id: string }) => {
      if (endpoint.id === 'http://a') throw new TypeError('node A unreachable');
      return endpoint.id;
    });

    await expect(router.request(first)).resolves.toBe('http://b');
    registry.recordProbeSuccess('http://a');

    const second = vi.fn(async (endpoint: { id: string }) => endpoint.id);
    await expect(router.request(second)).resolves.toBe('http://b');
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('routes a mutation once through current authority and does not replay an ambiguous failure', async () => {
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
    const router = new ClusterEndpointRouter(registry);
    await router.request(async (endpoint) => endpoint.id === 'http://a'
      ? Promise.reject(new TypeError('node A unreachable'))
      : endpoint.id);
    const mutation = vi.fn(async (_endpoint: { id: string }) => { throw new TypeError('connection lost after send'); });

    await expect(router.mutation(mutation)).rejects.toThrow();
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0]?.[0].id).toBe('http://b');
  });

  it('reports every exhausted endpoint instead of implying only the final node was tried', async () => {
    const router = new ClusterEndpointRouter(new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b'])));
    await expect(router.request(async () => { throw new TypeError('unavailable'); }))
      .rejects.toThrow('All Macha API endpoints failed (http://a, http://b)');
  });
});
