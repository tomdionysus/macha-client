import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackSource } from '@machafoundation/core';

/**
 * The read-ahead worker is the only way a Direct Play source reports a status,
 * and it is unreachable in a test environment: `serviceWorkerAvailable()` is
 * false, so the player never subscribes and the branch under test never runs.
 * Mocked at the module boundary so the failure can be delivered directly.
 */
const readAheadFailureListeners: Array<(error: Error & { status?: number }) => void> = [];
vi.mock('../playback/directPlayReadAhead', () => ({
  addDirectPlayReadAheadAlternative: vi.fn(() => false),
  directPlayReadAheadMetrics: vi.fn(() => undefined),
  directPlayReadAheadUrl: vi.fn((source: PlaybackSource) => `${source.url}#proxied`),
  releaseDirectPlayReadAhead: vi.fn(),
  setDirectPlayReadAheadMode: vi.fn(),
  subscribeDirectPlayReadAheadFailure: vi.fn((_url: string, listener: (error: Error & { status?: number }) => void) => {
    readAheadFailureListeners.push(listener);
    return () => undefined;
  }),
}));

const { WebPlatform } = await import('./WebPlatform');

function fakeVideo() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const video = {
    listeners,
    paused: false,
    currentTime: 0,
    duration: 100,
    ended: false,
    seeking: false,
    readyState: 4,
    networkState: 2,
    error: { code: 4, message: 'no supported source' },
    buffered: { length: 1, start: () => 0, end: () => 30 },
    seekable: { length: 1, start: () => 0, end: () => 100 },
    src: '',
    pauseCalls: 0,
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    querySelectorAll: vi.fn(() => []),
    appendChild: vi.fn(),
    addTextTrack: vi.fn(),
    load: vi.fn(),
    play: () => Promise.resolve(),
    pause() { this.pauseCalls += 1; this.paused = true; },
    addEventListener(type: string, listener: (event: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: Event) => void) { listeners.get(type)?.delete(listener); },
  };
  return video as unknown as HTMLVideoElement & { pauseCalls: number; listeners: Map<string, Set<(event: Event) => void>> };
}

function emit(video: { listeners: Map<string, Set<(event: Event) => void>> }, type: string) {
  for (const listener of video.listeners.get(type) ?? []) listener({ type } as Event);
}

const directSource: PlaybackSource = {
  mediaId: 'm1',
  url: 'https://node.test/api/v1/playback/stream/session/cap/file.mkv',
  isManifest: false,
  mimeType: 'video/x-matroska',
  mode: 'direct',
  sizeBytes: 1024 * 1024,
};

describe('a source the node no longer has must not take the presentation with it', () => {
  afterEach(() => {
    readAheadFailureListeners.length = 0;
    vi.unstubAllGlobals();
  });

  async function playingPlayer() {
    vi.stubGlobal('HTMLMediaElement', { HAVE_FUTURE_DATA: 3, HAVE_NOTHING: 0 });
    const video = fakeVideo();
    vi.stubGlobal('document', { createElement: vi.fn(() => video) });
    const player = new WebPlatform().createPlayer();
    player.attach({ firstChild: null, appendChild: vi.fn() } as unknown as HTMLElement);
    const failures: Array<Error & { kind?: string }> = [];
    player.subscribeFailure?.((error) => failures.push(error as Error & { kind?: string }));
    await player.play(directSource, 0, false);
    return { player, video, failures };
  }

  it('reports a 404 without destroying the buffer the viewer is still watching', async () => {
    // The whole recovery depends on this. Core cannot regenerate into a live
    // element if the adapter has already paused it and torn the source down —
    // measured, that teardown happens 6 ms after the fatal and takes 60+ s of
    // playable video with it. So `not-found` reports and does nothing else.
    const { video, failures } = await playingPlayer();
    expect(readAheadFailureListeners).toHaveLength(1);

    const gone: Error & { status?: number } = new Error('Direct Play source returned 404');
    gone.status = 404;
    readAheadFailureListeners[0](gone);
    // The element then raises its own error, because the worker handed the 404
    // body to it as though it were media. That is the failure core must not be
    // allowed to read as "this node is bad".
    emit(video, 'error');

    expect(failures.map((failure) => failure.kind)).toContain('not-found');
    expect(video.pauseCalls).toBe(0);
    expect(video.paused).toBe(false);
  });

  it('still tears down for a failure that is genuinely the end of the road', async () => {
    // The guard is narrow on purpose. Without a prior `not-found` for this
    // generation an element error is what it has always been: terminal, and the
    // presentation stops. A latch that swallowed every media error would leave
    // a viewer watching nothing with no message.
    const { video, failures } = await playingPlayer();
    emit(video, 'error');

    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe('unsupported');
    expect(video.pauseCalls).toBeGreaterThan(0);
  });
});
