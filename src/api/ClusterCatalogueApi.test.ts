import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapEndpoints, EndpointRegistry } from '../cluster/EndpointRegistry';
import { ClusterCatalogueApi, MAX_ABANDONED_MEDIA_PROFILE_REQUESTS } from './ClusterCatalogueApi';

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

  it('does not make a nominally successful but unready catalogue authoritative', async () => {
    const unavailable = {
      enabled: true, ready: false, metadata_generation: 0, root: null, items: 0,
      artwork_objects: 0, local_artwork_objects: 0, last_sync_unix_ms: 0,
      error: 'divergent metadata heads have no known common ancestor',
    };
    const ready = { ...unavailable, ready: true, error: null };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(unavailable))
      .mockResolvedValueOnce(response(ready));
    vi.stubGlobal('fetch', fetchMock);
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));

    await expect(new ClusterCatalogueApi(registry).status()).resolves.toEqual(ready);
    expect(registry.candidates()[0]?.endpoint.id).toBe('http://b');
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

  it('accepts profile_pending when other profile endpoints are unreachable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: 'profile_pending', message: 'pending' }, 202))
      .mockRejectedValueOnce(new TypeError('other node unreachable'));
    vi.stubGlobal('fetch', fetchMock);
    const api = new ClusterCatalogueApi(new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b'])));

    await expect(api.mediaProfile('macha:pending')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lets an abandoned profile finish and caches its immutable result', async () => {
    const profile = { schema_version: 1, media_id: 'macha:corpus', format: 'mp4', duration_ms: 60_000, bitrate: 1_000, streams: [] };
    let complete!: (response: Response) => void;
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((resolve, reject) => {
        complete = resolve;
        requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = new ClusterCatalogueApi(new EndpointRegistry(bootstrapEndpoints(['http://a'])));
    const consumer = new AbortController();
    const result = api.mediaProfile('macha:corpus', consumer.signal);
    const abandoned = expect(result).rejects.toMatchObject({ name: 'AbortError' });

    consumer.abort(new DOMException('left detail', 'AbortError'));
    await abandoned;
    expect(requestSignal?.aborted).toBe(false);

    complete(response(profile));
    await vi.waitFor(async () => {
      await expect(api.mediaProfile('macha:corpus')).resolves.toEqual(profile);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('aborts the oldest abandoned profile when the bounded corpus tail is full', async () => {
    const requestSignals: AbortSignal[] = [];
    const completions: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        requestSignals.push(signal);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }
      completions.push(resolve);
    }));
    vi.stubGlobal('fetch', fetchMock);
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a']));
    const api = new ClusterCatalogueApi(registry);

    for (let index = 0; index <= MAX_ABANDONED_MEDIA_PROFILE_REQUESTS; index += 1) {
      const consumer = new AbortController();
      const result = api.mediaProfile(`macha:${index}`, consumer.signal);
      const abandoned = expect(result).rejects.toMatchObject({ name: 'AbortError' });
      consumer.abort(new DOMException('left detail', 'AbortError'));
      await abandoned;
    }

    expect(requestSignals).toHaveLength(MAX_ABANDONED_MEDIA_PROFILE_REQUESTS + 1);
    expect(requestSignals[0]?.aborted).toBe(true);
    expect(requestSignals.slice(1).every((signal) => !signal.aborted)).toBe(true);
    await vi.waitFor(() => expect(registry.candidates()[0]?.health.consecutiveFailures).toBe(0));
    for (const complete of completions.slice(1)) {
      complete(response({ error: 'profile_pending', message: 'pending' }, 202));
    }
  });
});
