import { afterEach, describe, expect, it, vi } from 'vitest';
import { MachaCatalogueApi } from './MachaCatalogueApi';

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const item = {
  id: 'show:black-books',
  kind: 'show' as const,
  title: 'Black Books',
  sort_title: 'Black Books',
  synopsis: '',
  parent_id: null,
  year: 2000,
  season_number: null,
  episode_number: null,
  disc_number: null,
  track_number: null,
  aliases: [],
  external_ids: {},
  media_ids: [],
  artwork: [],
  revision: 1,
  updated_ns: 0,
};

describe('MachaCatalogueApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the Macha catalogue list endpoint and query names', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [item] }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new MachaCatalogueApi('http://node.test/');

    const result = await api.list('season', 'show:black-books');

    expect(result).toEqual([item]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://node.test/api/v1/catalogue/items?type=season&parent=show%3Ablack-books',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('reads immutable media profiles and treats profile_not_available as temporary', async () => {
    const profile = { schema_version: 1, media_id: 'macha:abc', format: 'mp4', duration_ms: 60_000, bitrate: 1_000, streams: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(profile))
      .mockResolvedValueOnce(jsonResponse(
        { error: 'profile_not_available', message: 'media profile is not available yet' },
        { status: 404 },
      ));
    vi.stubGlobal('fetch', fetchMock);
    const api = new MachaCatalogueApi('http://node.test');

    await expect(api.mediaProfile('macha:abc')).resolves.toEqual(profile);
    await expect(api.mediaProfile('macha:pending')).resolves.toBeUndefined();
    await expect(api.mediaProfile('path:/mutable.mp4')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://node.test/api/v1/catalogue/media/macha%3Aabc/profile',
      'http://node.test/api/v1/catalogue/media/macha%3Apending/profile',
    ]);
  });

  it('accepts successful not-available-yet profile responses as temporary absence', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'profile_pending', message: 'not available yet' }, { status: 202, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new MachaCatalogueApi('http://node.test');

    await expect(api.mediaProfile('macha:pending-202')).resolves.toBeUndefined();
    await expect(api.mediaProfile('macha:pending-204')).resolves.toBeUndefined();
  });

  it('rejects a profile whose immutable identity does not match the request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      schema_version: 1, media_id: 'macha:other', format: 'mp4', duration_ms: 1, bitrate: 1, streams: [],
    })));
    const api = new MachaCatalogueApi('http://node.test');

    await expect(api.mediaProfile('macha:requested')).rejects.toMatchObject({ code: 'invalid_media_profile' });
  });

  it('uses the catalogue search envelope and configured bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [item] }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new MachaCatalogueApi('http://node.test', 'secret');

    await api.search('black books', 25);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://node.test/api/v1/catalogue/search?q=black%20books&limit=25');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret');
  });

  it('uploads manual artwork through the catalogue item artwork endpoint', async () => {
    const artwork = { role: 'poster', id: 'sha256:abcd', mime_type: 'image/jpeg' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(artwork));
    vi.stubGlobal('fetch', fetchMock);
    const api = new MachaCatalogueApi('http://node.test', 'secret');
    const blob = new Blob(['image'], { type: 'image/jpeg' });

    await expect(api.putArtwork('movie:one', 'poster', 'image/jpeg', blob)).resolves.toEqual(artwork);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://node.test/api/v1/catalogue/items/movie%3Aone/artwork?role=poster&mime=image%2Fjpeg');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(blob);
    expect(new Headers(init.headers).get('Content-Type')).toBe('image/jpeg');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret');
  });

  it('fetches content-addressed artwork with authentication', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['image']), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new MachaCatalogueApi('http://node.test', 'secret');
    await api.artwork('abcd');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://node.test/api/v1/catalogue/artwork/abcd');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret');
  });

  it('rejects empty and non-image artwork responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(new Blob([]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }))
      .mockResolvedValueOnce(new Response(new Blob(['not an image'], { type: 'text/plain' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new MachaCatalogueApi('http://node.test');

    await expect(api.artwork('empty')).rejects.toThrow('empty artwork');
    await expect(api.artwork('text')).rejects.toThrow('non-image artwork');
  });

  it('passes artwork cancellation through to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['image']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new MachaCatalogueApi('http://node.test');
    const controller = new AbortController();

    await api.artwork('abcd', controller.signal);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it('clears catalogue metadata with optimistic revision protection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new MachaCatalogueApi('http://node.test', 'secret');

    await api.clearMetadata('show:black-books', 7);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://node.test/api/v1/catalogue/items/show%3Ablack-books/metadata');
    expect(init.method).toBe('DELETE');
    expect(new Headers(init.headers).get('If-Match')).toBe('"rev-7"');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret');
  });

  it('surfaces Macha JSON errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
      { error: 'catalogue_unavailable', message: 'catalogue root object unavailable' },
      { status: 503 },
    )));
    const api = new MachaCatalogueApi('');

    await expect(api.status()).rejects.toThrow('catalogue root object unavailable');
  });
  it('reports a network failure as an unreachable Macha server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const api = new MachaCatalogueApi('http://node.test');

    await expect(api.status()).rejects.toThrow('The Macha server cannot be reached.');
  });

  it('treats a proxy-generated non-JSON 500 as an unreachable Macha server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('connect ECONNREFUSED', { status: 500 })));
    const api = new MachaCatalogueApi('');

    await expect(api.status()).rejects.toThrow('The Macha server cannot be reached.');
  });

  it('keeps a JSON 500 from Macha as a catalogue error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
      { error: 'catalogue_failed', message: 'catalogue exploded' },
      { status: 500 },
    )));
    const api = new MachaCatalogueApi('');

    await expect(api.status()).rejects.toThrow('Macha catalogue request failed: catalogue exploded');
  });

});
