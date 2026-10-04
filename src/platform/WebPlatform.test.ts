import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KeyframeIndex, PlaybackEvent } from '@machafoundation/core';
import {
  hlsEventSummary,
  shouldUseManagedHls,
  webHlsBufferConfig,
  webLocalSeekCoverage,
  webPlaybackEventsEqual,
  handoverJoinLost,
  forwardBufferMsAt,
  handoverFallbackPositionMs,
  leadJoinStep,
  canHoldThroughRelocation,
  webMediaElementFailure,
  preflightWebHlsSource,
  webHlsPreflightTargets,
  HLS_PREFLIGHT_TIMEOUT_MS,
  WebPlatform,
  directPlayBufferedRanges,
  setKeyframeSource,
} from './WebPlatform';
import { ManagedHlsMediaRecoveryBudget } from './ManagedHlsRecovery';
import { PlaybackSourceError, SERVER_SEGMENT_HOLD_MS, SERVER_STARTUP_TIMEOUT_MS } from '@machafoundation/core';

afterEach(() => vi.unstubAllGlobals());

function fakeVideo() {
  const emptyRanges = { length: 0, start: () => 0, end: () => 0 } as unknown as TimeRanges;
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    removeAttribute: vi.fn(),
    setAttribute: vi.fn(),
    load: vi.fn(),
    pause: vi.fn(),
    // Teardown clears any subtitle <track> children through this.
    querySelectorAll: vi.fn(() => [] as unknown as NodeListOf<Element>),
    canPlayType: vi.fn(() => ''),
    parentNode: null,
    paused: true,
    volume: 1,
    src: '',
    currentTime: 0,
    duration: NaN,
    ended: false,
    seeking: false,
    readyState: 0,
    networkState: 0,
    buffered: emptyRanges,
    seekable: emptyRanges,
    playbackRate: 1,
    currentSrc: '',
    error: null,
  } as unknown as HTMLVideoElement;
}

/** Fire an event on the fake element by replaying its captured handlers. */
function emit(video: HTMLVideoElement, event: string): void {
  const registered = (video.addEventListener as unknown as { mock: { calls: [string, () => void][] } }).mock.calls;
  for (const [name, handler] of registered) if (name === event) handler();
}

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

describe('Web player source reassignment', () => {
  it('does not reset the reused media element via removeAttribute/load before assigning a new direct-play source', async () => {
    const video = fakeVideo();
    vi.stubGlobal('document', { createElement: vi.fn(() => video) });
    const player = new WebPlatform().createPlayer();
    player.attach({ firstChild: null, appendChild: vi.fn() } as unknown as HTMLElement);

    const source = { mediaId: 'm1', url: 'https://node.test/stream', isManifest: false, mimeType: 'video/mp4', mode: 'direct' as const };
    // The second play reuses the <video>. Assigning src already runs the load algorithm; a
    // removeAttribute('src')/load() first can leave it loading forever under a Service Worker.
    await player.play(source, 0, true);
    await player.play(source, 0, true);

    expect(video.removeAttribute).not.toHaveBeenCalled();
    expect(video.load).not.toHaveBeenCalled();
    expect(video.src).toBe(source.url);
  });

  it('registers a Direct Play alternative without touching the media element', async () => {
    // Registration is a `postMessage`: the element must never reload, or the swap becomes visible.
    const video = fakeVideo();
    vi.stubGlobal('document', { createElement: vi.fn(() => video) });
    const player = new WebPlatform().createPlayer();
    player.attach({ firstChild: null, appendChild: vi.fn() } as unknown as HTMLElement);
    const source = { mediaId: 'm1', url: 'https://node-a.test/stream', isManifest: false, mimeType: 'video/mp4', mode: 'direct' as const };
    await player.play(source, 0, true);

    player.addDirectSourceAlternative?.(source, { ...source, url: 'https://node-b.test/stream' });

    expect(video.src).toBe(source.url);
    expect(video.load).not.toHaveBeenCalled();
    expect(video.removeAttribute).not.toHaveBeenCalled();
  });

  /**
   * A native player has no retry policy, so a fragment still being produced reads as a node
   * failure. The element gets the URL only once the node will serve it.
   */
  describe('a native HLS source', () => {
    const hlsSource = {
      mediaId: 'm1',
      url: 'https://node.test/g/media.m3u8',
      isManifest: true,
      mimeType: 'application/vnd.apple.mpegurl',
      mode: 'remux' as const,
    };

    function nativePlayer(video: HTMLVideoElement) {
      vi.stubGlobal('document', { createElement: vi.fn(() => video) });
      const player = new WebPlatform({ forceNativeHls: true }).createPlayer();
      player.attach({ firstChild: null, appendChild: vi.fn() } as unknown as HTMLElement);
      return player;
    }

    it('asks core to hold the source until the node has produced media, and only on this path', () => {
      // A native player cannot ride a 500 hold; hls.js can.
      expect(nativePlayer(fakeVideo()).needsProducedSource).toBe(true);
      expect(new WebPlatform({ forceNativeHls: true }).createPlayer().holdsThroughLead).toBe(false);
    });

    it('attaches the URL at once, and asks the node for nothing', async () => {
      // Core has already waited on the session route, so there is nothing to probe.
      const video = fakeVideo();
      const player = nativePlayer(video);
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      await player.play(hlsSource, 0, true);
      expect(video.src).toBe(hlsSource.url);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('a source that never delivers a byte', () => {
    const directSource = {
      mediaId: 'm1',
      url: 'https://node.test/stream',
      isManifest: false,
      mimeType: 'video/mp4',
      mode: 'direct' as const,
    };

    function attachedPlayer(video: HTMLVideoElement) {
      vi.stubGlobal('document', { createElement: vi.fn(() => video) });
      const player = new WebPlatform().createPlayer();
      player.attach({ firstChild: null, appendChild: vi.fn() } as unknown as HTMLElement);
      return player;
    }

    /**
     * A fake element that accepts `play()`. `publish()` reads `HTMLMediaElement.HAVE_FUTURE_DATA`,
     * which a suite with no DOM must stub.
     */
    function playableVideo(): HTMLVideoElement {
      vi.stubGlobal('HTMLMediaElement', { HAVE_FUTURE_DATA: 3 });
      const video = fakeVideo();
      (video as unknown as { play: () => Promise<void> }).play = () => Promise.resolve();
      return video;
    }

    /** One publish at a new position. Arming the stall watchdog takes two: a baseline and an advance. */
    function advanceTo(video: HTMLVideoElement, seconds: number): void {
      (video as { currentTime: number }).currentTime = seconds;
      emit(video, 'timeupdate');
    }

    function setPaused(video: HTMLVideoElement, paused: boolean): void {
      (video as { paused: boolean }).paused = paused;
      emit(video, paused ? 'pause' : 'play');
    }

    it('holds a pause indefinitely rather than deciding the source died', async () => {
      vi.useFakeTimers();
      try {
        const video = playableVideo();
        const player = attachedPlayer(video);
        const failures: Error[] = [];
        player.subscribeFailure?.((error) => failures.push(error));

        await player.play(directSource, 0, false);
        // Bytes reached the element: the start watchdog stands down, leaving only the stall budget.
        emit(video, 'progress');
        setPaused(video, false);
        advanceTo(video, 1);
        advanceTo(video, 2);

        player.pause();
        setPaused(video, true);

        // Far past the stall budget, but paused: nobody is waiting on the node.
        vi.advanceTimersByTime(120_000);
        expect(failures).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('judges the node again from the moment playback resumes', async () => {
      vi.useFakeTimers();
      try {
        const video = playableVideo();
        const player = attachedPlayer(video);
        const failures: Error[] = [];
        player.subscribeFailure?.((error) => failures.push(error));

        await player.play(directSource, 0, false);
        emit(video, 'progress');
        setPaused(video, false);
        advanceTo(video, 1);
        advanceTo(video, 2);
        player.pause();
        setPaused(video, true);
        vi.advanceTimersByTime(120_000);
        expect(failures).toEqual([]);

        // The node died during the pause; the budget runs again from the resume.
        player.resume();
        setPaused(video, false);
        emit(video, 'timeupdate');
        vi.advanceTimersByTime(120_000);

        expect(failures).toHaveLength(1);
        expect(failures[0]?.message).toContain('nothing arrived');
      } finally {
        vi.useRealTimers();
      }
    });

    it('surfaces a retryable stream failure so the coordinator can fail over', async () => {
      vi.useFakeTimers();
      try {
        const video = fakeVideo();
        const player = attachedPlayer(video);
        const failures: Error[] = [];
        player.subscribeFailure?.((error) => failures.push(error));

        await player.play(directSource, 0, true);
        vi.advanceTimersByTime(19_000);
        expect(failures).toHaveLength(0);
        vi.advanceTimersByTime(1_000);

        expect(failures).toHaveLength(1);
        // 'stream' is what `isEndpointRetryablePlaybackFailure` accepts, routing this to another node.
        expect(failures[0]).toBeInstanceOf(PlaybackSourceError);
        expect((failures[0] as PlaybackSourceError).kind).toBe('stream');
      } finally {
        vi.useRealTimers();
      }
    });

    it('stands down as soon as any media data arrives', async () => {
      vi.useFakeTimers();
      try {
        const video = fakeVideo();
        const player = attachedPlayer(video);
        const failures: Error[] = [];
        player.subscribeFailure?.((error) => failures.push(error));

        await player.play(directSource, 0, true);
        vi.advanceTimersByTime(5_000);
        // Bytes arriving while readyState is still HAVE_NOTHING: a slow node, not a silent one.
        emit(video, 'progress');
        vi.advanceTimersByTime(600_000);

        expect(failures).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('is released by an explicit stop rather than firing after teardown', async () => {
      vi.useFakeTimers();
      try {
        const video = fakeVideo();
        const player = attachedPlayer(video);
        const failures: Error[] = [];
        player.subscribeFailure?.((error) => failures.push(error));

        await player.play(directSource, 0, true);
        player.stop();
        vi.advanceTimersByTime(600_000);

        expect(failures).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

});

describe('What leaves the player is whole milliseconds', () => {
  /**
   * The seek contract is in integer milliseconds: a fractional request against a generation
   * starting on the next whole millisecond reads as before its start, and core re-asks forever.
   * Duration and buffered ranges count too: they bound the scrubber and admit local seeks.
   */
  const directSource = {
    mediaId: 'm1', url: 'https://node.test/stream', isManifest: false,
    mimeType: 'video/mp4', mode: 'direct' as const,
  };

  function ranges(pairs: [number, number][]): TimeRanges {
    return {
      length: pairs.length,
      start: (index: number) => pairs[index][0],
      end: (index: number) => pairs[index][1],
    } as unknown as TimeRanges;
  }

  it('rounds every time it publishes, not only the position', async () => {
    vi.stubGlobal('HTMLMediaElement', { HAVE_FUTURE_DATA: 3 });
    const video = fakeVideo();
    vi.stubGlobal('document', { createElement: vi.fn(() => video) });
    const player = new WebPlatform().createPlayer();
    player.attach({ firstChild: null, appendChild: vi.fn() } as unknown as HTMLElement);

    const events: PlaybackEvent[] = [];
    player.subscribe?.((event) => events.push(event));
    await player.play(directSource, 0, true);

    // Seconds carrying float error, which become fractional milliseconds.
    Object.assign(video, {
      currentTime: 12.3456789,
      duration: 2706.336031,
      buffered: ranges([[0.040961, 120.99939]]),
      readyState: 4,
    });
    emit(video, 'timeupdate');

    const event = events.at(-1)!;
    expect(event.positionMs).toBe(12_346);
    // Floored: a duration must not claim media the element lacks, as a seek to the end clamps against it.
    expect(event.durationMs).toBe(2_706_336);
    expect(event.forwardBufferMs).toBe(108_654);
    // Widened outward; narrowing would refuse a seek the element could serve.
    expect(event.bufferedRangesMs).toEqual([{ startMs: 40, endMs: 121_000 }]);
  });
});

describe('Direct Play buffered ranges', () => {
  // The first 5 s of this ten-second file take 200 of its 1,000 bytes, so bytes 200-400
  // start the second half, where Chrome's even spread says 2-4 s.
  const uneven: KeyframeIndex = {
    mediaId: 'm1',
    container: 'mp4',
    offsets: 'sample',
    sizeBytes: 1_000,
    durationMs: 10_000,
    streams: [
      { index: 0, type: 'video', codec: 'h264', entries: [[0, 0], [5_000, 200]] },
      { index: 1, type: 'audio', codec: 'aac', entries: [[0, 0], [5_000, 200]] },
    ],
  };

  it('puts the bytes the element holds where the file says they play, not where an even spread would', () => {
    expect(directPlayBufferedRanges(uneven, [{ startMs: 2_000, endMs: 4_000 }], 10_000))
      .toEqual([{ startMs: 5_000, endMs: 6_250 }]);
  });

  it('leaves the ranges to the caller when the element has no duration to invert by', () => {
    expect(directPlayBufferedRanges(uneven, [{ startMs: 2_000, endMs: 4_000 }], Number.NaN)).toBeUndefined();
  });

  describe('on the player', () => {
    afterEach(() => setKeyframeSource(undefined));

    function ranges(pairs: [number, number][]): TimeRanges {
      return { length: pairs.length, start: (i: number) => pairs[i][0], end: (i: number) => pairs[i][1] } as unknown as TimeRanges;
    }

    async function playing(index: KeyframeIndex | undefined) {
      vi.stubGlobal('HTMLMediaElement', { HAVE_FUTURE_DATA: 3 });
      const video = fakeVideo();
      vi.stubGlobal('document', { createElement: vi.fn(() => video) });
      let resolveIndex: (value: KeyframeIndex | undefined) => void = () => undefined;
      const asked: string[] = [];
      setKeyframeSource((mediaId) => {
        asked.push(mediaId);
        return new Promise((resolve) => { resolveIndex = resolve; });
      });
      const player = new WebPlatform().createPlayer();
      player.attach({ firstChild: null, appendChild: vi.fn() } as unknown as HTMLElement);
      const events: PlaybackEvent[] = [];
      player.subscribe?.((event) => events.push(event));
      await player.play({ mediaId: 'm1', url: 'https://node.test/stream', isManifest: false, mimeType: 'video/mp4', mode: 'direct' }, 0, true);
      // Playing at 5.5 s, holding bytes 200-400, which Chrome reports as 2-4 s.
      Object.assign(video, { currentTime: 5.5, duration: 10, buffered: ranges([[2, 4]]), readyState: 4 });
      emit(video, 'timeupdate');
      const before = events.at(-1)!;
      resolveIndex(index);
      await Promise.resolve();
      await Promise.resolve();
      return { asked, before, after: events.at(-1)! };
    }

    it("reports Chrome's figures until the file's index arrives, then the element's real buffer", async () => {
      const { asked, before, after } = await playing(uneven);
      expect(asked).toEqual(['m1']);
      expect(before.bufferedRangesMs).toEqual([{ startMs: 2_000, endMs: 4_000 }]);
      expect(before.forwardBufferMs).toBe(0);
      expect(after.bufferedRangesMs).toEqual([{ startMs: 5_000, endMs: 6_250 }]);
      expect(after.forwardBufferMs).toBe(750);
    });

    it("keeps Chrome's figures for a file the node cannot index", async () => {
      const { after } = await playing(undefined);
      expect(after.bufferedRangesMs).toEqual([{ startMs: 2_000, endMs: 4_000 }]);
    });
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
      isManifest: true, mimeType: 'application/vnd.apple.mpegurl', mode: 'remux' as const,
    };

    await expect(preflightWebHlsSource(source, fetchMock)).resolves.toBe(true);
    expect(fetchMock.mock.calls.map(([url, init]) => ({ url, range: new Headers(init?.headers).get('range') }))).toEqual([
      { url: source.url, range: null },
      { url: 'https://node-b.test/generation/init.mp4', range: 'bytes=0-65535' },
      { url: 'https://node-b.test/generation/first.m4s', range: 'bytes=0-65535' },
    ]);
  });

  it('bounds a preflight by the serving node\'s stated deadline, not its own constant', async () => {
    // Asserted on the observed abort: a budget plumbed but never applied would pass a check of its value.
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    });
    const source = {
      mediaId: 'macha:one', url: 'https://node-b.test/generation/index.m3u8',
      isManifest: true, mimeType: 'application/vnd.apple.mpegurl', mode: 'remux' as const,
      budgets: { deadlineMs: 1, segmentHoldMs: 6_000 },
    };

    await expect(preflightWebHlsSource(source, fetchMock)).rejects.toMatchObject({ name: 'AbortError' });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('falls back to its own constant when the node states no deadline', async () => {
    // Absent is not zero: the default applies, so this must not abort.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nfirst.m4s', { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { status: 206 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([3, 4]), { status: 206 }));
    const source = {
      mediaId: 'macha:one', url: 'https://node-b.test/generation/index.m3u8',
      isManifest: true, mimeType: 'application/vnd.apple.mpegurl', mode: 'remux' as const,
    };

    await expect(preflightWebHlsSource(source, fetchMock)).resolves.toBe(true);
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
      isManifest: true, mimeType: 'application/vnd.apple.mpegurl', mode: 'remux' as const,
    };

    await expect(preflightWebHlsSource(source, fetchMock, 1)).rejects.toMatchObject({ name: 'AbortError' });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('reads the initial media bytes on a browser with no response streams', async () => {
    // Chromium 47 (Tizen 3) has fetch but no `response.body`; that must not read as "no bytes arrived".
    const unstreamed = (bytes: number[]) => ({
      ok: true,
      status: 206,
      body: undefined,
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    }) as unknown as Response;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('#EXTM3U\n#EXTINF:4,\nfirst.m4s', { status: 200 }))
      .mockResolvedValueOnce(unstreamed([1, 2]));
    const source = {
      mediaId: 'macha:one', url: 'https://node-b.test/generation/index.m3u8',
      isManifest: true, mimeType: 'application/vnd.apple.mpegurl', mode: 'remux' as const,
    };

    await expect(preflightWebHlsSource(source, fetchMock)).resolves.toBe(true);
  });

  it('waits longer than a healthy node is entitled to take to start a cold pipeline', async () => {
    // A standby's pipeline is lazy and its first fragment can take many seconds; the node's
    // own `startup_timeout_ms` is 15 s, so a shorter wait rejects a healthy node.
    vi.useFakeTimers();
    try {
      const slowFirstFragment = (init?: RequestInit) => new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        setTimeout(() => resolve(new Response(new Uint8Array([1, 2]), { status: 206 })), 9_000);
      });
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response('#EXTM3U\n#EXTINF:4,\nfirst.m4s', { status: 200 }))
        .mockImplementationOnce((_url: string, init?: RequestInit) => slowFirstFragment(init));
      const source = {
        mediaId: 'macha:one', url: 'https://node-b.test/generation/index.m3u8',
        isManifest: true, mimeType: 'application/vnd.apple.mpegurl', mode: 'transcode' as const,
      };

      const preflight = preflightWebHlsSource(source, fetchMock);
      await vi.advanceTimersByTimeAsync(9_000);
      await expect(preflight).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('derives the preflight budget from the server contract rather than picking one', () => {
    // The client's gate must stay above the server's startup budget.
    expect(HLS_PREFLIGHT_TIMEOUT_MS).toBeGreaterThan(SERVER_STARTUP_TIMEOUT_MS + SERVER_SEGMENT_HOLD_MS);
    expect(SERVER_STARTUP_TIMEOUT_MS).toBe(15_000);
  });

  it('rejects a standby whose initial media data is unavailable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nfirst.m4s', { status: 200 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    const source = {
      mediaId: 'macha:one', url: 'https://node-b.test/generation/index.m3u8',
      isManifest: true, mimeType: 'application/vnd.apple.mpegurl', mode: 'remux' as const,
    };

    await expect(preflightWebHlsSource(source, fetchMock)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('the stream route is the server\'s to choose', () => {
  // The client composes no stream path of its own: it resolves what the node hands it.
  const playlist = ['#EXTM3U', '#EXT-X-MAP:URI="init.mp4"', '#EXTINF:4,', 'segment-0.m4s'].join('\n');

  it('resolves a playlist against whatever route served it', () => {
    const removed = 'https://node.test/api/v1/playback/stream/abc/cap/1/index.m3u8';
    const current = 'https://node.test/api/v1/playback/sessions/abc/stream/cap/1/index.m3u8';

    expect(webHlsPreflightTargets(playlist, removed).mediaUrls).toEqual([
      'https://node.test/api/v1/playback/stream/abc/cap/1/init.mp4',
      'https://node.test/api/v1/playback/stream/abc/cap/1/segment-0.m4s',
    ]);
    expect(webHlsPreflightTargets(playlist, current).mediaUrls).toEqual([
      'https://node.test/api/v1/playback/sessions/abc/stream/cap/1/init.mp4',
      'https://node.test/api/v1/playback/sessions/abc/stream/cap/1/segment-0.m4s',
    ]);
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
  it('keeps a bounded minute-scale forward VOD buffer and leaves the initial seek to the app-level listener', () => {
    expect(webHlsBufferConfig()).toMatchObject({
      enableWorker: true,
      maxBufferLength: 60,
      maxMaxBufferLength: 120,
      maxBufferSize: 128 * 1024 * 1024,
      backBufferLength: 30,
    });
    expect(webHlsBufferConfig()).not.toHaveProperty('startPosition');
  });
});

describe('The media in front of a position', () => {
  it('counts only the range the position is actually in', () => {
    // Media beyond a hole is not runway: the element stops at the hole.
    const ranges = [{ startMs: 0, endMs: 12_000 }, { startMs: 30_000, endMs: 90_000 }];
    expect(forwardBufferMsAt(5_000, ranges)).toBe(7_000);
  });

  it('allows a range that begins just ahead of the position', () => {
    // The element and its ranges disagree by milliseconds; a small lead is not an empty buffer.
    expect(forwardBufferMsAt(5_000, [{ startMs: 5_040, endMs: 20_000 }])).toBe(15_000);
    expect(forwardBufferMsAt(5_000, [{ startMs: 5_400, endMs: 20_000 }])).toBe(0);
  });

  it('is the quantity a stale sample overstates, by the age of the sample', () => {
    // The same buffer 8 s apart with nothing arriving: the older sample claims 9 s where
    // 1 s is left, which is why the handover gate reads the element, not the last event.
    const ranges = [{ startMs: 0, endMs: 30_000 }];
    expect(forwardBufferMsAt(21_000, ranges)).toBe(9_000);
    expect(forwardBufferMsAt(29_000, ranges)).toBe(1_000);
  });
});

describe('Handover join convergence', () => {
  // A generation is encoded sequentially from its start, and the join recedes as the viewer
  // watches, so a replacement arrives only if it produces faster than realtime.

  it('declares the join lost when the replacement is losing ground to it', () => {
    // The gap grew over the window.
    expect(handoverJoinLost({
      startDeficitMs: 20_000, deficitMs: 26_000, observedMs: 6_000, remainingMs: 19_000,
    })).toBe(true);
  });

  it('declares it lost when the gap closes too slowly to close in the budget', () => {
    // Gaining, but at 0.1 ms per ms: 18 s of gap needs 180 s and there are 19.
    expect(handoverJoinLost({
      startDeficitMs: 19_200, deficitMs: 18_600, observedMs: 6_000, remainingMs: 19_000,
    })).toBe(true);
  });

  it('keeps waiting while the replacement is closing fast enough to arrive', () => {
    // 12 s of gap closed in 6 s leaves 8 s needing about 4.
    expect(handoverJoinLost({
      startDeficitMs: 20_000, deficitMs: 8_000, observedMs: 6_000, remainingMs: 19_000,
    })).toBe(false);
  });

  it('says nothing before a segment has had time to arrive', () => {
    // A segment arrives whole, so a sample inside one reads as zero production from a healthy source.
    expect(handoverJoinLost({
      startDeficitMs: 20_000, deficitMs: 26_000, observedMs: 900, remainingMs: 24_000,
    })).toBe(false);
  });
});

describe('Handover fallback position', () => {
  it('attaches where the viewer got to, not where core asked before the attempt', () => {
    // Core asked for 3,718 ms while the viewer sat at 29,561 ms on the old clock: an offset of
    // -25,843 ms. At 59,561 ms on the old clock they are at 33,718 ms on the new.
    expect(handoverFallbackPositionMs(3_718, -25_843, 59_561)).toBe(33_718);
  });

  it('never moves the viewer backwards when nothing advanced', () => {
    // A live position behind core's request is a stale sample, not a destination.
    expect(handoverFallbackPositionMs(3_718, -25_843, 29_561)).toBe(3_718);
    expect(handoverFallbackPositionMs(3_718, -25_843, 20_000)).toBe(3_718);
  });

  it('lands at the start of a generation built ahead of the viewer, never before it', () => {
    // A lead move's request is negative: the viewer is that far before the generation's start.
    expect(handoverFallbackPositionMs(-25_000, -60_000, 40_000)).toBe(0);
    expect(handoverFallbackPositionMs(-25_000, -60_000, 70_000)).toBe(10_000);
  });
});

describe('Joining a generation that starts ahead of the viewer', () => {
  // Core's lead move has the node produce from intent + lead, so the join lies before the
  // incoming generation until the viewer reaches its start. Waiting is expected.
  it('waits for the viewer while the join is still before the generation', () => {
    expect(leadJoinStep(-12_000, false)).toBe('wait');
  });

  it('joins at the start once the outgoing picture has stopped, rather than waiting for a position it cannot reach', () => {
    expect(leadJoinStep(-12_000, true)).toBe('join-at-start');
  });

  it('races as before once the join is inside the generation', () => {
    expect(leadJoinStep(0, false)).toBe('race');
    expect(leadJoinStep(4_000, true)).toBe('race');
  });
});

describe('Holding the picture through a relocation', () => {
  // A representation change mid-playback never reaches the handover path; only this hold
  // keeps the frame up. Whether the outgoing source is a manifest must not decide it.

  it('holds a Direct Play frame while a transcode replacement is built', () => {
    expect(canHoldThroughRelocation({
      incomingIsManifest: true, managedHls: true, outgoingReadyState: 4,
    })).toBe(true);
  });

  it('holds across a transcode relocation, as it always has', () => {
    expect(canHoldThroughRelocation({
      incomingIsManifest: true, managedHls: true, outgoingReadyState: 2,
    })).toBe(true);
  });

  it('declines when the replacement is not hls.js-driven', () => {
    // The element holding the frame would load these itself, so nothing can be prepared out of sight.
    expect(canHoldThroughRelocation({
      incomingIsManifest: true, managedHls: false, outgoingReadyState: 4,
    })).toBe(false);
    expect(canHoldThroughRelocation({
      incomingIsManifest: false, managedHls: true, outgoingReadyState: 4,
    })).toBe(false);
  });

  it('declines when there is no frame to hold', () => {
    // Nothing is on screen, so teardown costs the viewer nothing.
    expect(canHoldThroughRelocation({
      incomingIsManifest: true, managedHls: true, outgoingReadyState: 1,
    })).toBe(false);
    expect(canHoldThroughRelocation({
      incomingIsManifest: true, managedHls: true, outgoingReadyState: undefined,
    })).toBe(false);
  });
});

describe('Web local seek coverage', () => {
  it('exposes the whole Direct Play timeline without requiring buffered bytes', () => {
    expect(webLocalSeekCoverage({
      mediaId: 'm1', url: '/direct', isManifest: false, mimeType: 'video/mp4', mode: 'direct', durationMs: 600_000,
    }, [])).toEqual([{ startMs: 0, endMs: Number.POSITIVE_INFINITY }]);
  });

  it('exposes only resident ranges for transformed playback', () => {
    const buffered = [{ startMs: 5_000, endMs: 65_000 }];
    expect(webLocalSeekCoverage({
      mediaId: 'm1', url: '/generation.m3u8', isManifest: true, mimeType: 'application/vnd.apple.mpegurl', mode: 'transcode', durationMs: 600_000,
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
      isManifest: false, mimeType: 'video/mp4; codecs="avc1.640028"',
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
