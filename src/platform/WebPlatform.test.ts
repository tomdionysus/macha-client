import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hlsEventSummary,
  shouldUseManagedHls,
  webHlsBufferConfig,
  webLocalSeekCoverage,
  webPlaybackEventsEqual,
  webMediaElementFailure,
  preflightWebHlsSource,
  webHlsPreflightTargets,
  WebPlatform,
} from './WebPlatform';
import { ManagedHlsMediaRecoveryBudget } from './ManagedHlsRecovery';

afterEach(() => vi.unstubAllGlobals());

describe('Web player preparation', () => {
  it('constructs and configures one reusable media element before a presentation host exists', () => {
    const addEventListener = vi.fn();
    const video = {
      addEventListener,
      removeEventListener: vi.fn(),
      removeAttribute: vi.fn(),
      setAttribute: vi.fn(),
      canPlayType: vi.fn(() => 'probably'),
      parentNode: null,
      paused: true,
      volume: 1,
    } as unknown as HTMLVideoElement;
    const createElement = vi.fn(() => video);
    vi.stubGlobal('document', { createElement });
    const player = new WebPlatform().createPlayer();
    const profile = {
      mediaId: 'macha:immutable', format: 'mov,mp4', durationMs: 60_000, bitrate: 2_000_000, streams: [],
    };

    player.prepare?.(profile);
    player.prepare?.({ ...profile, negotiated: { mode: 'direct', mimeType: 'video/mp4', format: 'mp4' } });

    expect(createElement).toHaveBeenCalledTimes(1);
    expect(video.preload).toBe('auto');
    expect(video.crossOrigin).toBe('anonymous');
    expect(addEventListener).toHaveBeenCalledWith('loadedmetadata', expect.any(Function));

    const host = { firstChild: null, appendChild: vi.fn() } as unknown as HTMLElement;
    player.attach(host);
    expect(host.appendChild).toHaveBeenCalledWith(video);
  });
});

describe('Web HLS engine policy', () => {
  it('prefers hls.js/MSE on modern Web even when native HLS also exists', () => {
    expect(shouldUseManagedHls(undefined, true)).toBe(true);
    expect(shouldUseManagedHls(false, true)).toBe(true);
  });

  it('preserves the explicit native-HLS path for constrained/legacy targets', () => {
    expect(shouldUseManagedHls(true, true)).toBe(false);
    expect(shouldUseManagedHls(true, false)).toBe(false);
  });
});

describe('Web HLS standby preflight', () => {
  it('resolves an fMP4 initialization map and first segment against the generation manifest', () => {
    expect(webHlsPreflightTargets([
      '#EXTM3U',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:4.0,',
      'segment-0.m4s?cap=one',
    ].join('\n'), 'https://node-b.test/session/index.m3u8')).toEqual({
      mediaUrls: [
        'https://node-b.test/session/init.mp4',
        'https://node-b.test/session/segment-0.m4s?cap=one',
      ],
    });
  });

  it('validates the alternate manifest and initial media bytes without attaching it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nfirst.m4s', { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { status: 206 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([3, 4]), { status: 206 }));
    const source = {
      mediaId: 'macha:one', url: 'https://node-b.test/generation/index.m3u8',
      mimeType: 'application/vnd.apple.mpegurl', mode: 'remux' as const,
    };

    await expect(preflightWebHlsSource(source, fetchMock)).resolves.toBe(true);
    expect(fetchMock.mock.calls.map(([url, init]) => ({ url, range: new Headers(init?.headers).get('range') }))).toEqual([
      { url: source.url, range: null },
      { url: 'https://node-b.test/generation/init.mp4', range: 'bytes=0-65535' },
      { url: 'https://node-b.test/generation/first.m4s', range: 'bytes=0-65535' },
    ]);
  });

  it('bounds a stalled standby preflight TCP request', async () => {
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    });
    const source = {
      mediaId: 'macha:one', url: 'https://node-b.test/generation/index.m3u8',
      mimeType: 'application/vnd.apple.mpegurl', mode: 'remux' as const,
    };

    await expect(preflightWebHlsSource(source, fetchMock, 1)).rejects.toMatchObject({ name: 'AbortError' });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('rejects a standby whose initial media data is unavailable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nfirst.m4s', { status: 200 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    const source = {
      mediaId: 'macha:one', url: 'https://node-b.test/generation/index.m3u8',
      mimeType: 'application/vnd.apple.mpegurl', mode: 'remux' as const,
    };

    await expect(preflightWebHlsSource(source, fetchMock)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('Web media failure evidence', () => {
  it('distinguishes endpoint-retryable network failure from decoder and compatibility failure', () => {
    expect(webMediaElementFailure({ code: 2, message: 'connection lost' }).kind).toBe('stream');
    expect(webMediaElementFailure({ code: 3, message: 'bad frame' }).kind).toBe('media');
    expect(webMediaElementFailure({ code: 4, message: 'codec unavailable' }).kind).toBe('unsupported');
    expect(webMediaElementFailure(null).kind).toBe('unknown');
  });
});


describe('Web HLS buffer policy', () => {
  it('keeps a bounded minute-scale forward VOD buffer and starts at the requested local position', () => {
    expect(webHlsBufferConfig(42_000)).toMatchObject({
      enableWorker: true,
      maxBufferLength: 60,
      maxMaxBufferLength: 120,
      maxBufferSize: 128 * 1024 * 1024,
      backBufferLength: 30,
      startPosition: 42,
    });
  });
});

describe('Web local seek coverage', () => {
  it('exposes the whole Direct Play timeline without requiring buffered bytes', () => {
    expect(webLocalSeekCoverage({
      mediaId: 'm1', url: '/direct', mimeType: 'video/mp4', mode: 'direct', durationMs: 600_000,
    }, [])).toEqual([{ startMs: 0, endMs: Number.POSITIVE_INFINITY }]);
  });

  it('exposes only resident ranges for transformed playback', () => {
    const buffered = [{ startMs: 5_000, endMs: 65_000 }];
    expect(webLocalSeekCoverage({
      mediaId: 'm1', url: '/generation.m3u8', mimeType: 'application/vnd.apple.mpegurl', mode: 'transcode', durationMs: 600_000,
    }, buffered)).toEqual(buffered);
  });
});


describe('Managed Web HLS recovery', () => {
  it('permits only one fatal network restart per source generation', () => {
    const recovery = new ManagedHlsMediaRecoveryBudget();

    expect(recovery.fatalNetworkError()).toEqual({ action: 'restart', attempt: 1 });
    expect(recovery.fatalNetworkError()).toEqual({ action: 'fail', attempts: 1 });
  });

  it('allows one immediate media recovery but terminates a repeated fatal error without playback progress', () => {
    const recovery = new ManagedHlsMediaRecoveryBudget();

    expect(recovery.fatalMediaError(0)).toEqual({ action: 'recover', attempt: 1 });
    expect(recovery.fatalMediaError(0)).toEqual({
      action: 'fail',
      reason: 'no-progress-after-recovery',
      attempts: 1,
    });
  });

  it('permits a later recovery only after meaningful timeline progress and still enforces a hard source-generation budget', () => {
    const recovery = new ManagedHlsMediaRecoveryBudget(2, 2_000);

    expect(recovery.fatalMediaError(10_000)).toEqual({ action: 'recover', attempt: 1 });
    recovery.observePlaybackPosition(10_800, true);
    recovery.observePlaybackPosition(11_700, true);
    expect(recovery.fatalMediaError(11_700)).toMatchObject({ action: 'fail', reason: 'no-progress-after-recovery' });

    recovery.observePlaybackPosition(12_200, true);
    expect(recovery.fatalMediaError(12_200)).toEqual({ action: 'recover', attempt: 2 });
    recovery.observePlaybackPosition(14_500, true);
    expect(recovery.fatalMediaError(14_500)).toEqual({
      action: 'fail',
      reason: 'recovery-budget-exhausted',
      attempts: 2,
    });
  });

  it('does not count seek discontinuities as evidence that media recovery succeeded', () => {
    const recovery = new ManagedHlsMediaRecoveryBudget();

    recovery.fatalMediaError(0);
    recovery.observePlaybackPosition(120_000, false);
    recovery.observePlaybackPosition(120_500, true);

    expect(recovery.fatalMediaError(120_500)).toMatchObject({
      action: 'fail',
      reason: 'no-progress-after-recovery',
    });
  });

  it('retains SourceBuffer diagnostics needed to identify browser append failures', () => {
    expect(hlsEventSummary({
      type: 'mediaError',
      details: 'bufferAppendError',
      fatal: true,
      sourceBufferName: 'video',
      mimeType: 'video/mp4; codecs="avc1.640028"',
      reason: 'appendBuffer failed',
      error: new Error('SourceBuffer append failed'),
    })).toMatchObject({
      type: 'mediaError',
      details: 'bufferAppendError',
      fatal: true,
      sourceBufferName: 'video',
      mimeType: 'video/mp4; codecs="avc1.640028"',
      reason: 'appendBuffer failed',
      error: { name: 'Error', message: 'SourceBuffer append failed' },
    });
  });
});


describe('Web playback event publication', () => {
  const base = {
    positionMs: 10_000,
    durationMs: 100_000,
    paused: false,
    ended: false,
    seeking: false,
    buffering: false,
    bufferedRangesMs: [{ startMs: 0, endMs: 30_000 }],
    forwardBufferMs: 20_000,
  };

  it('suppresses duplicate media events so buffer refresh hooks do not create redundant UI work', () => {
    expect(webPlaybackEventsEqual(base, { ...base, bufferedRangesMs: [{ startMs: 0, endMs: 30_000 }] })).toBe(true);
  });

  it('publishes when buffered residency changes, including eviction', () => {
    expect(webPlaybackEventsEqual(base, {
      ...base,
      bufferedRangesMs: [{ startMs: 12_000, endMs: 30_000 }],
      forwardBufferMs: 20_000,
    })).toBe(false);
  });
});
