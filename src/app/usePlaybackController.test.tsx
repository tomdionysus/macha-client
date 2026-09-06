// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { MediaApi } from '../api/MediaApi';
import type { Platform } from '../platform/Platform';
import type { PlaybackRuntime, PlaybackRuntimeSnapshot } from '../playback/PlaybackRuntime';
import { ContinueWatchingStore } from '../state/continueWatching';
import { PlaybackQueueStore } from '../state/playbackQueue';
import { VolumeStore } from '../state/volume';
import type { MediaSummary } from '../types';
import { usePlaybackController } from './usePlaybackController';

function movie(id: string): MediaSummary {
  return { id, kind: 'movie', title: id, mediaIds: [`file:${id}`], durationMs: 600_000 };
}

/**
 * A stalled snapshot: play() was called but the runtime's own lifecycle
 * subscriber hasn't published a matching request yet. This is the real race
 * window (the runtime updates asynchronously) rather than something timed
 * against React's incidental batching.
 */
function stalledSnapshot(): PlaybackRuntimeSnapshot {
  return { phase: 'starting', generation: 1 };
}

const platform = {} as unknown as Platform;

describe('usePlaybackController route reconstruction', () => {
  beforeEach(() => localStorage.clear());

  it('does not re-issue play() for a navigation startPlayback already started', () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const runtime = { play, stop: vi.fn(), setReturnTo: vi.fn() } as unknown as PlaybackRuntime;
    const api = { details: vi.fn() } as unknown as MediaApi;
    // Constructed once, outside the render callback: real screens pass these
    // down as stable props, and a fresh instance per render would itself
    // retrigger every effect keyed on them.
    const progressStore = new ContinueWatchingStore('test-client');
    const queueStore = new PlaybackQueueStore('test-client');
    const volumeStore = new VolumeStore('test-client');

    const { result } = renderHook(
      (runtimeState: PlaybackRuntimeSnapshot) => usePlaybackController({
        api, platform, runtime, runtimeState, progressStore, queueStore, volumeStore,
      }),
      {
        initialProps: stalledSnapshot(),
        wrapper: ({ children }) => <MemoryRouter initialEntries={['/movies']}>{children}</MemoryRouter>,
      },
    );

    act(() => {
      result.current.startPlayback(movie('m1'));
    });

    // The route-reconstruction effect also ran (playerItemId is now 'm1' and
    // runtimeState.request never caught up), but the explicit-start guard
    // must have suppressed it: exactly the one play() startPlayback issued.
    expect(play).toHaveBeenCalledTimes(1);
    expect(api.details).not.toHaveBeenCalled();
  });

  it('does reconstruct playback for a route entered without an explicit startPlayback call', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const runtime = { play, stop: vi.fn(), setReturnTo: vi.fn() } as unknown as PlaybackRuntime;
    const details = vi.fn().mockResolvedValue(movie('m2'));
    const api = { details } as unknown as MediaApi;
    const progressStore = new ContinueWatchingStore('test-client');
    const queueStore = new PlaybackQueueStore('test-client');
    const volumeStore = new VolumeStore('test-client');

    renderHook(
      () => usePlaybackController({
        api, platform, runtime, runtimeState: stalledSnapshot(), progressStore, queueStore, volumeStore,
      }),
      { wrapper: ({ children }) => <MemoryRouter initialEntries={['/play/m2']}>{children}</MemoryRouter> },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // No prior explicit start for this navigation (e.g. a page reload on
    // /play/m2): the guard must not suppress the one legitimate reconstruction.
    expect(details).toHaveBeenCalledWith('m2');
    expect(play).toHaveBeenCalledTimes(1);
  });
});
