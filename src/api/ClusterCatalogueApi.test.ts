import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapEndpoints, EndpointRegistry } from '../cluster/EndpointRegistry';
import { ClusterCatalogueApi } from './ClusterCatalogueApi';

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ClusterCatalogueApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retries a safe read on the next bootstrap endpoint and makes it sticky', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('node A unreachable'))
      .mockResolvedValue(response({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
    const api = new ClusterCatalogueApi(registry);

    await expect(api.list('movie')).resolves.toEqual([]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://a/api/v1/catalogue/items?type=movie',
      'http://b/api/v1/catalogue/items?type=movie',
    ]);

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(response({ items: [] }));
    await api.list('movie');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://b/api/v1/catalogue/items?type=movie');
  });

  it('does not replay a mutation whose outcome is uncertain', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('connection lost after send'));
    vi.stubGlobal('fetch', fetchMock);
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
    const api = new ClusterCatalogueApi(registry);

    await expect(api.clearMetadata('movie:one')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls through temporary profile absence, coalesces requests and caches only the immutable positive', async () => {
    const profile = { schema_version: 1, media_id: 'macha:abc', format: 'mp4', duration_ms: 60_000, bitrate: 1_000, streams: [] };
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: 'profile_not_available', message: 'pending' }, 404))
      .mockImplementationOnce(async () => {
        await pending;
        return response(profile);
      });
    vi.stubGlobal('fetch', fetchMock);
    const api = new ClusterCatalogueApi(new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b'])));

    const first = api.mediaProfile('macha:abc');
    const coalesced = api.mediaProfile('macha:abc');
    release();
    await expect(Promise.all([first, coalesced])).resolves.toEqual([profile, profile]);
    await expect(api.mediaProfile('macha:abc')).resolves.toEqual(profile);
    await expect(api.mediaProfile('path:/movie.mp4')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://a/api/v1/catalogue/media/macha%3Aabc/profile',
      'http://b/api/v1/catalogue/media/macha%3Aabc/profile',
    ]);
  });

  it('does not negatively cache a temporarily unavailable immutable profile', async () => {
    const unavailable = { error: 'profile_not_available', message: 'pending' };
    const fetchMock = vi.fn().mockResolvedValue(response(unavailable, 404));
    vi.stubGlobal('fetch', fetchMock);
    const api = new ClusterCatalogueApi(new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b'])));

    await expect(api.mediaProfile('macha:pending')).resolves.toBeUndefined();
    await expect(api.mediaProfile('macha:pending')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
