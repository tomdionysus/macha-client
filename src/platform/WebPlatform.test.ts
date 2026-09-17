import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hlsEventSummary,
  shouldUseManagedHls,
  webHlsBufferConfig,
  webLocalSeekCoverage,
  webPlaybackEventsEqual,
  webMediaElementFailure,
  awaitNativeHlsFirstFragment,
  preflightWebHlsSource,
  webHlsPreflightTargets,
  HLS_PREFLIGHT_TIMEOUT_MS,
  SERVER_STARTUP_TIMEOUT_MS,
  WebPlatform,
} from './WebPlatform';
import { ManagedHlsMediaRecoveryBudget } from './ManagedHlsRecovery';
import { PlaybackSourceError, SERVER_SEGMENT_HOLD_MS } from '@machafoundation/core';

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

describe('Web player source reassignment', () => {
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

  it('does not reset the reused media element via removeAttribute/load before assigning a new direct-play source', async () => {
    const video = fakeVideo();
    vi.stubGlobal('document', { createElement: vi.fn(() => video) });
    const player = new WebPlatform().createPlayer();
    player.attach({ firstChild: null, appendChild: vi.fn() } as unknown as HTMLElement);

    const source = { mediaId: 'm1', url: 'https://node.test/stream', isManifest: false, mimeType: 'video/mp4', mode: 'direct' as const };
    // Two plays share one reused <video> element (the second exercises the
    // "existingVideo" reset path). Assigning a new src already runs the media
    // element load algorithm; a redundant removeAttribute('src')/load() call
    // immediately beforehand was observed live to race that reassignment and
    // leave the element stuck loading forever under an active Service Worker.
    await player.play(source, 0, true);
    await player.play(source, 0, true);

    expect(video.removeAttribute).not.toHaveBeenCalled();
    expect(video.load).not.toHaveBeenCalled();
    expect(video.src).toBe(source.url);
  });

  it('registers a Direct Play alternative without touching the media element', async () => {
    // The seamless swap's whole value is that the element never reloads: the
    // read-ahead worker changes the bytes underneath it and the viewer sees
    // nothing (measured at 17 ms, `alternate-promoted-silently`). Registration
    // is a `postMessage` today, so this cannot fail as written — it is here to
    // stop a later change quietly adding a reload to this path, which would
    // turn an invisible swap into a visible one with nothing to catch it.
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
   * A native player has no retry policy this client can reach, so a fragment
   * the node is still producing reaches the coordinator as the node having
   * failed — and three of those exhaust a healthy cluster. The element is
   * therefore not given the URL until the node will serve it.
   */
  describe('a native HLS source whose first fragment is still being produced', () => {
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

    it('holds the URL back until the node serves it, then attaches', async () => {
      const video = fakeVideo();
      const playlist = '#EXTM3U\n#EXTINF:6,\nsegment-0.ts';
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(new Response(playlist, { status: 200 }))
        .mockResolvedValueOnce(new Response('', { status: 500, headers: { 'Retry-After': '0' } }))
        .mockResolvedValueOnce(new Response(playlist, { status: 200 }))
        .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 206 })));

      await nativePlayer(video).play(hlsSource, 0, true);

      expect(video.src).toBe(hlsSource.url);
    });

    it('never charges the waiting node for a failure from the generation it is replacing', async () => {
      const video = fakeVideo();
      const player = nativePlayer(video);
      const failures: Error[] = [];
      player.subscribeFailure?.((error) => failures.push(error));
      let serveFragment = (_: Response) => {};
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(new Response('#EXTM3U\n#EXTINF:6,\nsegment-0.ts', { status: 200 }))
        .mockReturnValueOnce(new Promise<Response>((resolve) => { serveFragment = resolve; })));

      const playing = player.play(hlsSource, 0, true);
      await Promise.resolve();
      // The element is still holding the source of the node that just died,
      // and it says so while the replacement is being waited on.
      (video as { error: MediaError | null }).error = { code: 2, message: 'connection lost' } as MediaError;
      emit(video, 'error');
      expect(failures).toEqual([]);

      serveFragment(new Response(new Uint8Array([1]), { status: 206 }));
      await playing;
      expect(video.src).toBe(hlsSource.url);
    });

    it('reports a node that will not serve it as stream evidence, without ever attaching', async () => {
      const video = fakeVideo();
      const player = nativePlayer(video);
      const failures: Error[] = [];
      player.subscribeFailure?.((error) => failures.push(error));
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(new Response('#EXTM3U\n#EXTINF:6,\nsegment-0.ts', { status: 200 }))
        .mockResolvedValueOnce(new Response('', { status: 503 })));

      await expect(player.play(hlsSource, 0, true)).resolves.toBe(false);

      expect(video.src).toBe('');
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ kind: 'stream' });
    });
  });

  /**
   * The gap these close: every failure channel on this player is driven by
   * something the element emits, so an element that accepted a source and then
   * received nothing emitted nothing, and playback waited on it forever with
   * no error and no failover. Reported live as an unchanging spinner watched
   * for four minutes.
   */
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
     * A fake element that accepts `play()`, so the player's own resume path
     * runs rather than throwing before it reaches the element.
     *
     * The readiness constants live on the `HTMLMediaElement` constructor rather
     * than on an element, and `publish()` reads one of them, so a suite with no
     * DOM has to supply it or no fake element is usable at all.
     */
    function playableVideo(): HTMLVideoElement {
      vi.stubGlobal('HTMLMediaElement', { HAVE_FUTURE_DATA: 3 });
      const video = fakeVideo();
      (video as unknown as { play: () => Promise<void> }).play = () => Promise.resolve();
      return video;
    }

    /**
     * One publish at a new position. The stall watchdog is driven from these
     * and from nothing else, so arming it takes two: one to establish a
     * baseline and one to advance past it.
     */
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
        // Bytes reached the element, which stands the start watchdog down and
        // leaves the stall budget as the only thing judging what follows.
        emit(video, 'progress');
        setPaused(video, false);
        advanceTo(video, 1);
        advanceTo(video, 2);

        player.pause();
        setPaused(video, true);

        // Far past the stall budget. Nothing is arriving because nobody asked
        // for anything, and a viewer who paused has not been let down by a node.
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

        // The node died during the pause. Resuming is the first moment anyone
        // is waiting on it again, and the budget runs from there — suspending
        // the watchdog must never amount to switching it off.
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
        // 'stream' is what `isEndpointRetryablePlaybackFailure` accepts, which
        // is what routes this to another node instead of a dead end. A
        // decoder-flavoured kind here would strand the viewer.
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
        // Bytes arriving, long before readyState leaves HAVE_NOTHING. A slow
        // node must never be judged by this, only a silent one.
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
    // Chromium 47 (Tizen 3) has fetch and no `response.body`. Reading that as
    // "no bytes arrived" rejected every standby the Samsung ever prepared,
    // leaving the one set that most needs a warm alternate without any.
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
    // A standby is a freshly created transcode generation, and the server's
    // pipeline is lazy: nothing is produced until something asks. Measured
    // against `es-1` on 2026-09-17, the first fragment of such a generation
    // took **9.0 s** to arrive — and the node's own `startup_timeout_ms` is
    // 15 s, so it is entitled to take three times the old 5 s budget and still
    // be working correctly. Every one of those was being read as "that node
    // cannot serve it" and the rescue thrown away.
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
    // Two independently chosen numbers that were never compared is the fault
    // this repo keeps writing down, and a 5 s client gate against a 15 s server
    // startup was exactly that. Asserted so the budget cannot drift back under
    // the thing it has to clear.
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

describe('native HLS first-fragment readiness', () => {
  const manifest = '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXTINF:6,\nsegment-0.ts';
  const controllable = () => {
    const slept: number[] = [];
    let clock = 0;
    return {
      slept,
      options: {
        now: () => clock,
        sleep: async (ms: number) => { slept.push(ms); clock += ms; },
      },
    };
  };

  it('waits out a held fragment for as long as the node keeps saying it is producing one', async () => {
    const held = () => new Response('{"code":"segment_not_ready"}', { status: 500, headers: { 'Retry-After': '1' } });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(manifest, { status: 200 }))
      .mockResolvedValueOnce(held())
      .mockResolvedValueOnce(new Response(manifest, { status: 200 }))
      .mockResolvedValueOnce(held())
      .mockResolvedValueOnce(new Response(manifest, { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([7]), { status: 206 }));
    const host = controllable();

    await expect(awaitNativeHlsFirstFragment('https://node-b.test/g/media.m3u8', { fetchImpl, ...host.options }))
      .resolves.toMatchObject({ ready: true, attempts: 3 });
    // The node stated one second twice, and was believed both times.
    expect(host.slept).toEqual([1_000, 1_000]);
    expect(new Headers(fetchImpl.mock.calls[1][1]?.headers).get('range')).toBe('bytes=0-0');
  });

  it('never waits on a broken generation, which is the one thing that is node evidence', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(manifest, { status: 200 }))
      .mockResolvedValueOnce(new Response('{"code":"stream_failed"}', { status: 503 }));
    const host = controllable();

    await expect(awaitNativeHlsFirstFragment('https://node-b.test/g/media.m3u8', { fetchImpl, ...host.options }))
      .resolves.toMatchObject({ ready: false, reason: 'fragment answered 503', attempts: 1 });
    expect(host.slept).toEqual([]);
  });

  it('gives up on a node that holds the fragment past the budget, rather than holding the viewer forever', async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => Promise.resolve(
      String(url).endsWith('.m3u8')
        ? new Response(manifest, { status: 200 })
        : new Response('', { status: 500, headers: { 'Retry-After': '1' } }),
    ));
    const host = controllable();

    const readiness = await awaitNativeHlsFirstFragment('https://node-b.test/g/media.m3u8', {
      fetchImpl,
      timeoutMs: 4_000,
      ...host.options,
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toContain('for 3s');
    expect(host.slept).toEqual([1_000, 1_000, 1_000]);
  });

  it('treats a transfer that never became a response as the node, not the fragment', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const host = controllable();

    await expect(awaitNativeHlsFirstFragment('https://node-b.test/g/media.m3u8', { fetchImpl, ...host.options }))
      .resolves.toMatchObject({ ready: false, reason: 'Failed to fetch', attempts: 1 });
    expect(host.slept).toEqual([]);
  });

  it('abandons the wait the moment a later generation takes over', async () => {
    const fetchImpl = vi.fn();
    const readiness = await awaitNativeHlsFirstFragment('https://node-b.test/g/media.m3u8', {
      fetchImpl,
      superseded: () => true,
    });
    expect(readiness).toMatchObject({ ready: false, attempts: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
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
