import { afterEach, describe, expect, it, vi } from 'vitest';
import { MachaPlaybackResolver } from './MachaPlaybackResolver';
import type { MediaSummary, PlaybackCapabilities } from '../types';

const media: MediaSummary = {
  id: 'movie:test',
  kind: 'movie',
  title: 'Test',
  mediaIds: ['file:abc'],
};

const capabilities: PlaybackCapabilities = {
  platform: 'web',
  maxWidth: 1920,
  maxHeight: 1080,
  videoCodecs: ['h264'],
  audioCodecs: ['aac', 'mp3'],
  containers: ['mp4', 'webm'],
  hls: true,
  dash: false,
  hdr: [],
};

function sessionResponse(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'session-1',
    item_id: 'movie:test',
    media_id: 'file:abc',
    mode: 'remux',
    mime_type: 'application/vnd.apple.mpegurl',
    stream_url: '/api/v1/playback/stream/session-1/cap/1/master.m3u8',
    subtitle_url: null,
    selected: { video_stream: 0, audio_stream: 1, subtitle_stream: -1 },
    transform: { video: 'copy', audio: 'copy' },
    options: {
      modes: ['remux', 'transcode'],
      media_ids: ['file:abc'],
      audio_streams: [{ index: 1, type: 'audio', codec: 'aac', profile: 'LC', language: 'eng', default: true, forced: false, channels: 2 }],
      subtitle_streams: [],
      can_seek: true,
      can_change_quality: true,
      can_switch_media: false,
    },
    streams: [
      { index: 0, type: 'video', codec: 'h264', profile: 'High', language: '', default: true, forced: false, width: 1920, height: 1080 },
      { index: 1, type: 'audio', codec: 'aac', profile: 'LC', language: 'eng', default: true, forced: false, channels: 2 },
    ],
    source_format: 'matroska,webm',
    duration_ms: 5_400_000,
    source_bitrate: 8_000_000,
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('MachaPlaybackResolver', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a 0.7.0 playback session with browser capabilities and bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sessionResponse(), 201));
    vi.stubGlobal('fetch', fetchMock);
    const resolver = new MachaPlaybackResolver('http://node.test/', 'secret');

    const session = await resolver.resolve(media, capabilities);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://node.test/api/v1/playback/sessions');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret');
    expect(JSON.parse(String(init.body))).toEqual(expect.objectContaining({
      item_id: 'movie:test',
      capabilities: expect.objectContaining({
        containers: ['mp4', 'webm'],
        video_codecs: ['h264'],
        audio_codecs: ['aac', 'mp3'],
        hls_fmp4: true,
        max_width: 1920,
        max_height: 1080,
      }),
    }));
    expect(session.mode).toBe('remux');
    expect(session.source.url).toBe('http://node.test/api/v1/playback/stream/session-1/cap/1/master.m3u8');
    expect(session.options.audioStreams[0]).toEqual(expect.objectContaining({ index: 1, language: 'eng', channels: 2 }));
  });


  it('keeps a configured reverse-proxy prefix on returned capability URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sessionResponse(), 201));
    vi.stubGlobal('fetch', fetchMock);
    const resolver = new MachaPlaybackResolver('/macha', 'secret');

    const session = await resolver.resolve(media, capabilities);

    expect(fetchMock.mock.calls[0][0]).toBe('/macha/api/v1/playback/sessions');
    expect(session.source.url).toBe('/macha/api/v1/playback/stream/session-1/cap/1/master.m3u8');
  });

  it('maps PATCH controls to the server field names', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sessionResponse({
      mode: 'transcode',
      subtitle_url: '/api/v1/playback/stream/session-1/cap/2/subtitle.vtt',
      selected: { video_stream: 0, audio_stream: 2, subtitle_stream: 5 },
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

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
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
    expect(session.source.subtitleUrl).toBe('http://node.test/api/v1/playback/stream/session-1/cap/2/subtitle.vtt');
  });

  it('deletes the playback session explicitly', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const resolver = new MachaPlaybackResolver('http://node.test', 'secret');

    await resolver.stop('session-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://node.test/api/v1/playback/sessions/session-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
