// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaApi } from '@macha/core';
import type { Platform } from '@macha/core';
import type { PlaybackRuntime, PlaybackRuntimeSnapshot } from '@macha/core';
import { ContinueWatchingStore } from '@macha/core';
import { PlaybackQueueStore } from '@macha/core';
import { VolumeStore } from '@macha/core';
import type { MediaSummary } from '@macha/core';
import { usePlaybackController } from './usePlaybackController';

// Real `navigate()` calls, minus actually applying them to the route: in the
// real app, React Router commits a navigate-away asynchronously relative to
// the runtime's own lifecycle subscription, so a render can legitimately
// observe "stop() was told to navigate away" and "we're still on
// /play/:id" at the same time. `MemoryRouter` in a synchronous test flushes
// both together, which would hide exactly the race this file exists to
// catch — so `useLocation` here is driven by a variable this file controls
// directly, independent of when `navigate` was called.
let fakePathname = '/play/m1';
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    useLocation: () => ({ pathname: fakePathname, search: '', hash: '', state: null, key: 'test' }),
  };
});

function movie(id: string): MediaSummary {
  return { id, kind: 'movie', title: id, mediaIds: [`file:${id}`], durationMs: 600_000 };
}

const platform = {} as unknown as Platform;

describe('usePlaybackController stop() vs. route-reconstruction race', () => {
  it('does not restart playback when the runtime clears before the router commits the navigate-away', () => {
    // Regression test: stop() while still on /play/:id races the runtime
    // clearing its active request against the router applying the
    // navigate() call. If the runtime wins, the reconstruct-from-route
    // effect used to see "on the player route, no active playback" — this
    // client's signature for "reload deep-linked into the player" — and
    // restarted the very session stop() was just told to close.
    fakePathname = '/play/m1';
    const play = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue(undefined);
    const runtime = { play, stop, setReturnTo: vi.fn() } as unknown as PlaybackRuntime;
    const api = { details: vi.fn() } as unknown as MediaApi;
    const progressStore = new ContinueWatchingStore('test-client');
    const queueStore = new PlaybackQueueStore('test-client');
    const volumeStore = new VolumeStore('test-client');
    const activeRequest = { media: movie('m1'), startPositionMs: 0, returnTo: '/movies/m1' };

    const { result, rerender } = renderHook(
      (runtimeState: PlaybackRuntimeSnapshot) => usePlaybackController({
        api, platform, runtime, runtimeState, progressStore, queueStore, volumeStore,
      }),
      { initialProps: { phase: 'playing', generation: 1, request: activeRequest } as PlaybackRuntimeSnapshot },
    );

    act(() => { result.current.stop(); });
    expect(navigateSpy).toHaveBeenCalledWith('/movies/m1', { replace: true });

    // The runtime's async teardown resolves (request cleared) before the
    // router has actually committed the navigate-away — `fakePathname`
    // deliberately still says `/play/m1` here.
    rerender({ phase: 'idle', generation: 1 } as PlaybackRuntimeSnapshot);

    expect(play).not.toHaveBeenCalled();
    expect(api.details).not.toHaveBeenCalled();

    // Once the route genuinely catches up, normal reconstruction behavior
    // must resume rather than staying suppressed forever.
    fakePathname = '/movies/m1';
    rerender({ phase: 'idle', generation: 1 } as PlaybackRuntimeSnapshot);
    expect(play).not.toHaveBeenCalled();
  });

  it('does not restart playback on the same race triggered by handleEnded()', () => {
    fakePathname = '/play/m1';
    const play = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue(undefined);
    const runtime = { play, stop, setReturnTo: vi.fn() } as unknown as PlaybackRuntime;
    const api = { details: vi.fn() } as unknown as MediaApi;
    const progressStore = new ContinueWatchingStore('test-client');
    const queueStore = new PlaybackQueueStore('test-client');
    const volumeStore = new VolumeStore('test-client');
    const activeRequest = { media: movie('m1'), startPositionMs: 0, returnTo: '/movies/m1' };

    const { result, rerender } = renderHook(
      (runtimeState: PlaybackRuntimeSnapshot) => usePlaybackController({
        api, platform, runtime, runtimeState, progressStore, queueStore, volumeStore,
      }),
      { initialProps: { phase: 'playing', generation: 1, request: activeRequest } as PlaybackRuntimeSnapshot },
    );

    act(() => { result.current.handleEnded(); });
    rerender({ phase: 'idle', generation: 1 } as PlaybackRuntimeSnapshot);

    expect(play).not.toHaveBeenCalled();
    expect(api.details).not.toHaveBeenCalled();
  });
});
