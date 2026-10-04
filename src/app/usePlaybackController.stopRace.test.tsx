// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaApi } from '@machafoundation/core';
import type { Platform } from '@machafoundation/core';
import type { PlaybackRuntime, PlaybackRuntimeSnapshot } from '@machafoundation/core';
import { ContinueWatchingStore } from '@machafoundation/core';
import { PlaybackQueueStore } from '@machafoundation/core';
import { VolumeStore } from '../state/volume';
import type { MediaSummary } from '@machafoundation/core';
import { usePlaybackController } from './usePlaybackController';

// `useLocation` reads a variable rather than following `navigate`: the real router commits a
// navigate-away after the runtime's lifecycle update, and MemoryRouter would flush both together.
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
    // If the runtime clears before the router leaves /play/:id, the route effect sees its
    // deep-link signature (player route, no active playback) and must not restart the session.
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
        api, platform, runtime, runtimeState, progressStore, queueStore, volumeStore, ready: true,
      }),
      { initialProps: { phase: 'playing', generation: 1, request: activeRequest } as PlaybackRuntimeSnapshot },
    );

    act(() => { result.current.stop(); });
    expect(navigateSpy).toHaveBeenCalledWith('/movies/m1', { replace: true });

    // The runtime has cleared; the route still says /play/m1.
    rerender({ phase: 'idle', generation: 1 } as PlaybackRuntimeSnapshot);

    expect(play).not.toHaveBeenCalled();
    expect(api.details).not.toHaveBeenCalled();

    // Once the route catches up, reconstruction is no longer suppressed.
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
        api, platform, runtime, runtimeState, progressStore, queueStore, volumeStore, ready: true,
      }),
      { initialProps: { phase: 'playing', generation: 1, request: activeRequest } as PlaybackRuntimeSnapshot },
    );

    act(() => { result.current.handleEnded(); });
    rerender({ phase: 'idle', generation: 1 } as PlaybackRuntimeSnapshot);

    expect(play).not.toHaveBeenCalled();
    expect(api.details).not.toHaveBeenCalled();
  });
});
