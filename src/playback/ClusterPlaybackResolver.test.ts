import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapEndpoints, EndpointRegistry } from '../cluster/EndpointRegistry';
import type { MediaSummary, PlaybackCapabilities } from '../types';
import { ClusterPlaybackResolver } from './ClusterPlaybackResolver';

const media: MediaSummary = { id: 'movie:test', kind: 'movie', title: 'Test', mediaIds: ['macha:media'] };
const capabilities: PlaybackCapabilities = {
  platform: 'web', videoCodecs: ['h264'], audioCodecs: ['aac'], containers: ['mp4'], hls: true, dash: false, hdr: [],
};

function wireSession(id: string) {
  return {
    session_id: id, item_id: media.id, media_id: 'macha:media', mode: 'direct', duration_ms: 60_000, seek_ms: 12_000,
    preferences: { mode: 'auto', max_height: null, max_bitrate: null, audio_stream: null, subtitle_stream: null, audio_language: '', subtitle_language: '' },
    selection: { video_stream: 0, audio_stream: 1, subtitle_stream: -1 },
    source: { path: '/movie.mp4', format: 'mp4', size: 1000, bitrate: 100, streams: [] },
    output: {}, stream: { url: `/api/v1/playback/stream/${id}`, mime_type: 'video/mp4', subtitle_url: null },
    options: { modes: ['direct'], quality_heights: [], media_ids: ['macha:media'], audio_streams: [], subtitle_streams: [], can_seek: true, can_change_quality: false, can_switch_media: false },
  };
}

describe('ClusterPlaybackResolver', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a disposable generation on an alternate endpoint after node failure', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('node A unreachable'))
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('session-b')), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
    const resolver = new ClusterPlaybackResolver(registry);

    const session = await resolver.resolve(media, capabilities, 12_000, { audioLanguage: 'eng' });
    expect(session.endpoint).toEqual({ id: 'http://b', baseUrl: 'http://b' });
    expect(session.source.url).toBe('http://b/api/v1/playback/stream/session-b');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://a/api/v1/playback/sessions',
      'http://b/api/v1/playback/sessions',
    ]);
    const attemptHeaders = fetchMock.mock.calls.map(([, init]) => new Headers((init as RequestInit).headers));
    expect(attemptHeaders[0]?.get('Idempotency-Key')).toBeTruthy();
    expect(attemptHeaders[1]?.get('Idempotency-Key')).toBe(attemptHeaders[0]?.get('Idempotency-Key'));
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(secondBody).toEqual(expect.objectContaining({ seek_ms: 12_000, preferences: expect.objectContaining({ audio_language: 'eng' }) }));
  });

  it('recovers on another node when a non-conforming server gates session admission on profile_pending', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: 'profile_pending', message: 'media profile is not available yet' }),
        { status: 425, headers: { 'Content-Type': 'application/json', 'Retry-After': '5' } },
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('session-b')), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const resolver = new ClusterPlaybackResolver(new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b'])));

    await expect(resolver.resolve(media, capabilities)).resolves.toMatchObject({
      endpoint: { id: 'http://b' },
      sessionId: expect.stringContaining('session-b'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const headers = fetchMock.mock.calls.map(([, init]) => new Headers((init as RequestInit).headers));
    expect(headers[0]?.get('Idempotency-Key')).toBeTruthy();
    expect(headers[1]?.get('Idempotency-Key')).toBe(headers[0]?.get('Idempotency-Key'));
  });

  it('retains one viewer identity while distinct admissions receive distinct idempotency keys', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('session-a')), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('session-b')), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const resolver = new ClusterPlaybackResolver(new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b'])));
    const context = { viewerSessionId: 'viewer-stable' };

    const primary = await resolver.resolve(media, capabilities, 0, undefined, context);
    await resolver.failover(primary, media, capabilities, 20_000, { mode: 'auto' }, undefined, context);

    const headers = fetchMock.mock.calls.map(([, init]) => new Headers((init as RequestInit).headers));
    expect(headers.map((entry) => entry.get('Macha-Viewer-Session'))).toEqual(['viewer-stable', 'viewer-stable']);
    expect(headers[0]?.get('Idempotency-Key')).toBeTruthy();
    expect(headers[1]?.get('Idempotency-Key')).toBeTruthy();
    expect(headers[1]?.get('Idempotency-Key')).not.toBe(headers[0]?.get('Idempotency-Key'));
  });

  it('routes updates and teardown to the generation endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('session-a')), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('session-a')), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const resolver = new ClusterPlaybackResolver(new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b'])));

    const session = await resolver.resolve(media, capabilities);
    await resolver.update(session.sessionId, { seekMs: 20_000 });
    await resolver.stop(session.sessionId);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://a/api/v1/playback/sessions',
      'http://a/api/v1/playback/sessions/session-a',
      'http://a/api/v1/playback/sessions/session-a',
    ]);
  });

  it('does not mark the session endpoint unhealthy when the viewer cancels a superseded update', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('session-a')), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockImplementationOnce((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }));
    vi.stubGlobal('fetch', fetchMock);
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
    const resolver = new ClusterPlaybackResolver(registry);
    const active = await resolver.resolve(media, capabilities);
    const controller = new AbortController();

    const update = resolver.update(active.sessionId, { seekMs: 20_000 }, controller.signal);
    controller.abort(new DOMException('superseded', 'AbortError'));

    await expect(update).rejects.toMatchObject({ name: 'AbortError' });
    expect(registry.snapshot().find((entry) => entry.endpoint.id === 'http://a')?.health).not.toBe('unreachable');
  });

  it('recreates a failed generation on an untried node and then exhausts candidates', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('session-a')), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('session-b')), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const resolver = new ClusterPlaybackResolver(new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b'])));

    const first = await resolver.resolve(media, capabilities);
    const second = await resolver.failover(first, media, capabilities, 21_000, { mode: 'direct' });
    expect(second.endpoint?.id).toBe('http://b');
    await expect(resolver.failover(second, media, capabilities, 22_000, { mode: 'direct' }))
      .rejects.toThrow('No untried Macha playback endpoint remains');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('continues failover after one surviving node cannot open the media', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('session-a')), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'media_open_failed', message: 'open media: Input/output error' }), { status: 500, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('session-c')), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const resolver = new ClusterPlaybackResolver(new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b', 'http://c'])));
    const active = await resolver.resolve(media, capabilities);

    const replacement = await resolver.failover(active, media, capabilities, 21_000, { mode: 'auto' });

    expect(replacement.endpoint?.id).toBe('http://c');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://a/api/v1/playback/sessions',
      'http://b/api/v1/playback/sessions',
      'http://c/api/v1/playback/sessions',
    ]);
    const replacementAttempts = fetchMock.mock.calls.slice(1).map(([, init]) => ({
      key: new Headers((init as RequestInit).headers).get('Idempotency-Key'),
      body: (init as RequestInit).body,
    }));
    expect(replacementAttempts[0]?.key).toBeTruthy();
    expect(replacementAttempts[1]).toEqual(replacementAttempts[0]);
  });

  it('prepares one Direct standby without displacing the active endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('session-a')), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('session-b')), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const registry = new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b']));
    const resolver = new ClusterPlaybackResolver(registry);
    const context = { viewerSessionId: 'viewer-standby' };
    const primary = await resolver.resolve(media, capabilities, undefined, undefined, context);

    const alternate = await resolver.prepareAlternate(primary, media, capabilities, 5_000, { mode: 'auto' }, context);

    expect(alternate?.endpoint?.id).toBe('http://b');
    expect(registry.candidates()[0]?.endpoint.id).toBe('http://a');
    const body = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(body.preferences.mode).toBe('direct');
    const headers = fetchMock.mock.calls.map(([, init]) => new Headers((init as RequestInit).headers));
    expect(headers.map((entry) => entry.get('Macha-Viewer-Session'))).toEqual(['viewer-standby', 'viewer-standby']);
    expect(headers[1]?.get('Idempotency-Key')).not.toBe(headers[0]?.get('Idempotency-Key'));
  });

  it('abandons a hung standby POST and attempts the next known endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('session-a')), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockImplementationOnce((_url: string, init?: RequestInit) => {
        expect(init?.signal).toBeUndefined();
        return new Promise<Response>(() => undefined);
      })
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('session-c')), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const resolver = new ClusterPlaybackResolver(
      new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b', 'http://c'])),
      undefined,
      5,
    );
    const primary = await resolver.resolve(media, capabilities);

    const alternate = await resolver.prepareAlternate(primary, media, capabilities, 0, { mode: 'direct' });

    expect(alternate?.endpoint?.id).toBe('http://c');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://a/api/v1/playback/sessions',
      'http://b/api/v1/playback/sessions',
      'http://c/api/v1/playback/sessions',
    ]);
  });

  it('promotes a prepared transformed generation without creating a duplicate lease', async () => {
    const transformed = (id: string) => ({
      ...wireSession(id),
      mode: 'remux',
      preferences: { ...wireSession(id).preferences, mode: 'remux' },
      stream: { url: `/api/v1/playback/stream/${id}/index.m3u8`, mime_type: 'application/vnd.apple.mpegurl', subtitle_url: null },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(transformed('session-a')), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(transformed('session-b')), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const resolver = new ClusterPlaybackResolver(new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b'])));
    const primary = await resolver.resolve(media, capabilities, 0, { mode: 'remux' });
    const standby = await resolver.prepareAlternate(primary, media, capabilities, 0, { mode: 'remux' });

    const promoted = await resolver.failover(primary, media, capabilities, 5_000, { mode: 'remux' }, standby);

    expect(promoted.sessionId).toBe(standby?.sessionId);
    expect(promoted.endpoint?.id).toBe('http://b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps identical node-local session IDs distinct across endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('same-id')), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(wireSession('same-id')), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const resolver = new ClusterPlaybackResolver(new EndpointRegistry(bootstrapEndpoints(['http://a', 'http://b'])));
    const primary = await resolver.resolve(media, capabilities);
    const alternate = await resolver.prepareAlternate(primary, media, capabilities, 0, { mode: 'direct' });

    expect(primary.sessionId).not.toBe(alternate?.sessionId);
    await resolver.stop(primary.sessionId);
    await resolver.stop(alternate!.sessionId);
    expect(fetchMock.mock.calls.slice(2).map(([url]) => url)).toEqual([
      'http://a/api/v1/playback/sessions/same-id',
      'http://b/api/v1/playback/sessions/same-id',
    ]);
  });
});
