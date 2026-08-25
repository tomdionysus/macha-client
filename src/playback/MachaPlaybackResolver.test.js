import { afterEach, describe, expect, it, vi } from 'vitest';
import { MachaPlaybackResolver } from './MachaPlaybackResolver';
const media = {
    id: 'movie:test',
    kind: 'movie',
    title: 'Test',
    mediaIds: ['file:abc'],
};
const capabilities = {
    platform: 'web',
    videoCodecs: ['h264'],
    audioCodecs: ['aac', 'mp3'],
    containers: ['mp4', 'webm'],
    hls: true,
    dash: false,
    hdr: [],
};
function sessionResponse(overrides = {}) {
    const base = {
        session_id: 'session-1',
        item_id: 'movie:test',
        media_id: 'file:abc',
        mode: 'remux',
        duration_ms: 5_400_000,
        seek_ms: 0,
        preferences: {
            mode: 'auto',
            max_height: null,
            max_bitrate: null,
            audio_stream: null,
            subtitle_stream: null,
            audio_language: '',
            subtitle_language: '',
        },
        selection: { video_stream: 0, audio_stream: 1, subtitle_stream: -1 },
        source: {
            path: '/Movies/Test.mkv',
            format: 'matroska,webm',
            size: 10_000_000,
            bitrate: 8_000_000,
            streams: [
                { index: 0, type: 'video', codec: 'h264', profile: 'High', language: '', default: true, forced: false, width: 1920, height: 1080, bitrate: 3_700_000 },
                { index: 1, type: 'audio', codec: 'aac', profile: 'LC', language: 'eng', default: true, forced: false, channels: 2, bitrate: 192_000 },
            ],
        },
        output: {
            format: 'mp4',
            video: { source_stream: 0, transform: 'copy', codec: 'h264', profile: 'High', width: 1920, height: 1080 },
            audio: { source_stream: 1, transform: 'copy', codec: 'aac', profile: 'LC', channels: 2 },
        },
        stream: {
            mime_type: 'application/vnd.apple.mpegurl',
            url: '/api/v1/playback/stream/session-1/cap/1/master.m3u8',
            subtitle_url: null,
        },
        options: {
            modes: ['remux', 'transcode'],
            quality_heights: [720, 480, 360],
            media_ids: ['file:abc'],
            audio_streams: [{ index: 1, type: 'audio', codec: 'aac', profile: 'LC', language: 'eng', default: true, forced: false, channels: 2, bitrate: 192_000 }],
            subtitle_streams: [],
            can_seek: true,
            can_change_quality: true,
            can_switch_media: false,
        },
    };
    return { ...base, ...overrides };
}
function jsonResponse(value, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
describe('MachaPlaybackResolver', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('creates a playback session with browser capabilities and bearer auth', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sessionResponse(), 201));
        vi.stubGlobal('fetch', fetchMock);
        const resolver = new MachaPlaybackResolver('http://node.test/', 'secret');
        const session = await resolver.resolve(media, capabilities);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://node.test/api/v1/playback/sessions');
        expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret');
        expect(JSON.parse(String(init.body))).toEqual(expect.objectContaining({
            item_id: 'movie:test',
            capabilities: expect.objectContaining({
                containers: ['mp4', 'webm'],
                video_codecs: ['h264'],
                audio_codecs: ['aac', 'mp3'],
                hls_fmp4: true,
            }),
        }));
        const requestBody = JSON.parse(String(init.body));
        expect(requestBody.capabilities).not.toHaveProperty('max_width');
        expect(requestBody.capabilities).not.toHaveProperty('max_height');
        expect(session.mode).toBe('remux');
        expect(session.seekMs).toBe(0);
        expect(session.preferences.mode).toBe('auto');
        expect(session.source.url).toBe('http://node.test/api/v1/playback/stream/session-1/cap/1/master.m3u8');
        expect(session.source.sizeBytes).toBe(10_000_000);
        expect(session.sourceInfo).toEqual(expect.objectContaining({ path: '/Movies/Test.mkv', format: 'matroska,webm', bitrate: 8_000_000 }));
        expect(session.sourceInfo.streams[0]).toEqual(expect.objectContaining({ index: 0, codec: 'h264', width: 1920, height: 1080, bitrate: 3_700_000 }));
        expect(session.output.video).toEqual(expect.objectContaining({ sourceStream: 0, transform: 'copy', codec: 'h264' }));
        expect(session.options.modes).toEqual(['direct', 'remux', 'transcode']);
        expect(session.options.qualityHeights).toEqual([720, 480, 360]);
        expect(session.options.audioStreams[0]).toEqual(expect.objectContaining({ index: 1, language: 'eng', channels: 2, bitrate: 192_000 }));
    });
    it('prefers Direct on Samsung while Web remains Auto', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(sessionResponse(), 201));
        vi.stubGlobal('fetch', fetchMock);
        const resolver = new MachaPlaybackResolver('http://node.test', 'secret');
        await resolver.resolve(media, { ...capabilities, platform: 'tizen' });
        const [, samsungInit] = fetchMock.mock.calls[0];
        expect(JSON.parse(String(samsungInit.body))).toEqual(expect.objectContaining({
            preferences: { mode: 'direct' },
        }));
        fetchMock.mockClear();
        await resolver.resolve(media, capabilities);
        const [, webInit] = fetchMock.mock.calls[0];
        expect(JSON.parse(String(webInit.body))).toEqual(expect.objectContaining({
            preferences: { mode: 'auto' },
        }));
    });
    it('includes the initial resume position in session creation', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sessionResponse({ seek_ms: 42_000 }), 201));
        vi.stubGlobal('fetch', fetchMock);
        const resolver = new MachaPlaybackResolver('http://node.test', 'secret');
        const session = await resolver.resolve(media, capabilities, 42_000);
        const [, init] = fetchMock.mock.calls[0];
        expect(JSON.parse(String(init.body))).toEqual(expect.objectContaining({ seek_ms: 42_000 }));
        expect(session.seekMs).toBe(42_000);
    });
    it('only sends decoder resolution limits when the platform explicitly reports them', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sessionResponse(), 201));
        vi.stubGlobal('fetch', fetchMock);
        const resolver = new MachaPlaybackResolver('http://node.test', 'secret');
        await resolver.resolve(media, { ...capabilities, maxWidth: 3840, maxHeight: 2160 });
        const [, init] = fetchMock.mock.calls[0];
        expect(JSON.parse(String(init.body))).toEqual(expect.objectContaining({
            capabilities: expect.objectContaining({
                max_width: 3840,
                max_height: 2160,
            }),
        }));
    });
    it('keeps a configured reverse-proxy prefix on returned capability URLs', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sessionResponse(), 201));
        vi.stubGlobal('fetch', fetchMock);
        const resolver = new MachaPlaybackResolver('/macha', 'secret');
        const session = await resolver.resolve(media, capabilities);
        expect(fetchMock.mock.calls[0][0]).toBe('/macha/api/v1/playback/sessions');
        expect(session.source.url).toBe('/macha/api/v1/playback/stream/session-1/cap/1/master.m3u8');
    });
    it('sends seek-only PATCHes without preferences so the server can use its fast path', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sessionResponse({ seek_ms: 42000 })));
        vi.stubGlobal('fetch', fetchMock);
        const resolver = new MachaPlaybackResolver('http://node.test', 'secret');
        const session = await resolver.update('session-1', { seekMs: 42_000 });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://node.test/api/v1/playback/sessions/session-1');
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(String(init.body))).toEqual({ seek_ms: 42_000 });
        expect(session.seekMs).toBe(42_000);
    });
    it('sends subtitle-only PATCHes without an implicit seek', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sessionResponse({
            stream: {
                mime_type: 'application/vnd.apple.mpegurl',
                url: '/api/v1/playback/stream/session-1/cap/1/master.m3u8',
                subtitle_url: '/api/v1/playback/stream/session-1/cap/1/subtitle-5/manifest.json',
            },
            selection: { video_stream: 0, audio_stream: 1, subtitle_stream: 5 },
        })));
        vi.stubGlobal('fetch', fetchMock);
        const resolver = new MachaPlaybackResolver('http://node.test', 'secret');
        await resolver.update('session-1', {
            preferences: { subtitleStream: 5, subtitleLanguage: '' },
        });
        const [, init] = fetchMock.mock.calls[0];
        expect(JSON.parse(String(init.body))).toEqual({
            preferences: { subtitle_stream: 5, subtitle_language: '' },
        });
    });
    it('sends an explicit Direct preference even when the server options omitted Direct', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sessionResponse({
            mode: 'direct',
            preferences: {
                mode: 'direct', max_height: null, max_bitrate: null,
                audio_stream: null, subtitle_stream: null, audio_language: '', subtitle_language: '',
            },
            stream: {
                mime_type: 'video/x-matroska',
                url: '/api/v1/playback/stream/session-1/direct',
                subtitle_url: null,
            },
            options: {
                ...sessionResponse().options,
                modes: ['remux', 'transcode'],
            },
        })));
        vi.stubGlobal('fetch', fetchMock);
        const resolver = new MachaPlaybackResolver('http://node.test', 'secret');
        const session = await resolver.update('session-1', { preferences: { mode: 'direct' } });
        const [, init] = fetchMock.mock.calls[0];
        expect(JSON.parse(String(init.body))).toEqual({ preferences: { mode: 'direct' } });
        expect(session.preferences.mode).toBe('direct');
        expect(session.mode).toBe('direct');
    });
    it('maps PATCH controls to the server field names', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sessionResponse({
            mode: 'transcode',
            stream: {
                mime_type: 'application/vnd.apple.mpegurl',
                url: '/api/v1/playback/stream/session-1/cap/2/master.m3u8',
                subtitle_url: '/api/v1/playback/stream/session-1/cap/2/subtitle-5/manifest.json',
            },
            selection: { video_stream: 0, audio_stream: 2, subtitle_stream: 5 },
            preferences: {
                mode: 'transcode', max_height: 720, max_bitrate: 4_000_000,
                audio_stream: 2, subtitle_stream: 5, audio_language: '', subtitle_language: '',
            },
        })));
        vi.stubGlobal('fetch', fetchMock);
        const resolver = new MachaPlaybackResolver('http://node.test', 'secret');
        const session = await resolver.update('session-1', {
            seekMs: 5_040_000,
            mediaId: 'file:def',
            preferences: {
                mode: 'transcode',
                maxHeight: 720,
                maxBitrate: 4_000_000,
                audioStream: 2,
                subtitleStream: 5,
            },
        });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://node.test/api/v1/playback/sessions/session-1');
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(String(init.body))).toEqual({
            preferences: {
                mode: 'transcode',
                max_height: 720,
                max_bitrate: 4_000_000,
                audio_stream: 2,
                subtitle_stream: 5,
            },
            seek_ms: 5_040_000,
            media_id: 'file:def',
        });
        expect(session.source.subtitleUrl).toBe('http://node.test/api/v1/playback/stream/session-1/cap/2/subtitle-5/manifest.json');
    });
    it('deletes the playback session explicitly', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);
        const resolver = new MachaPlaybackResolver('http://node.test', 'secret');
        await resolver.stop('session-1');
        expect(fetchMock).toHaveBeenCalledWith('http://node.test/api/v1/playback/sessions/session-1', expect.objectContaining({ method: 'DELETE' }));
    });
    it('surfaces structured server playback errors without object coercion', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            error: {
                code: 'media_unavailable',
                message: 'No playable media source',
            },
        }, 409));
        vi.stubGlobal('fetch', fetchMock);
        const resolver = new MachaPlaybackResolver('http://node.test', 'secret');
        await expect(resolver.resolve(media, capabilities)).rejects.toMatchObject({
            message: 'Macha playback request failed: No playable media source',
            status: 409,
            code: 'media_unavailable',
        });
    });
});
