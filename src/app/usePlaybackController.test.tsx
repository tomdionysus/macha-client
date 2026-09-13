// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { MediaApi } from '@machafoundation/core';
import type { Platform } from '@machafoundation/core';
import type { PlaybackRuntime, PlaybackRuntimeSnapshot } from '@machafoundation/core';
import { ContinueWatchingStore } from '@machafoundation/core';
import { PlaybackQueueStore } from '@machafoundation/core';
import { VolumeStore } from '@machafoundation/core';
import type { Episode, MediaSummary, SeasonDetails } from '@machafoundation/core';
import { usePlaybackController } from './usePlaybackController';

function movie(id: string): MediaSummary {
  return { id, kind: 'movie', title: id, mediaIds: [`file:${id}`], durationMs: 600_000 };
}

function episode(id: string, episodeNumber: number): Episode {
  return {
    id,
    kind: 'episode',
    title: id,
    mediaIds: [`file:${id}`],
    durationMs: 600_000,
    seasonNumber: 1,
    episodeNumber,
    playbackContext: {
      series: { id: 'show1', title: 'A Show' },
      season: { id: 'season1', title: 'Season 1', seasonNumber: 1 },
    },
  };
}

function season(episodes: Episode[]): SeasonDetails {
  return {
    id: 'season1',
    kind: 'season',
    title: 'Season 1',
    mediaIds: [],
    showId: 'show1',
    seasonNumber: 1,
    episodes,
  };
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

describe('usePlaybackController season queue', () => {
  beforeEach(() => localStorage.clear());

  function harness(api: MediaApi, runtime: PlaybackRuntime, path = '/') {
    const progressStore = new ContinueWatchingStore('test-client');
    const queueStore = new PlaybackQueueStore('test-client');
    const volumeStore = new VolumeStore('test-client');
    return renderHook(
      () => usePlaybackController({
        api, platform, runtime, runtimeState: stalledSnapshot(), progressStore, queueStore, volumeStore,
      }),
      { wrapper: ({ children }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter> },
    );
  }

  it('widens a lone episode into its season so the transport has next and previous', async () => {
    // Resuming an episode from Continue Watching passes no queue — nothing was
    // open to build one from — and the player showed no next or previous for
    // something that plainly has both.
    const play = vi.fn().mockResolvedValue(undefined);
    const runtime = { play, stop: vi.fn(), setReturnTo: vi.fn() } as unknown as PlaybackRuntime;
    const episodes = [episode('e1', 1), episode('e2', 2), episode('e3', 3)];
    const details = vi.fn().mockResolvedValue(season(episodes));
    const api = { details } as unknown as MediaApi;

    const { result } = harness(api, runtime);
    act(() => { result.current.startPlayback(episodes[1]); });

    // Playback is not held for the season: the request goes out first, on the
    // single item, and the siblings arrive behind it.
    expect(play).toHaveBeenCalledTimes(1);
    expect(result.current.canNext).toBe(false);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(details).toHaveBeenCalledWith('season1');
    expect(result.current.queueState?.items.map((item) => item.id)).toEqual(['e1', 'e2', 'e3']);
    expect(result.current.queueState?.currentIndex).toBe(1);
    expect(result.current.canPrevious).toBe(true);
    expect(result.current.canNext).toBe(true);
    // Widening must not restart anything: exactly the one play() from the start.
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('leaves a queue the viewer built alone', async () => {
    // The season arrives after the fact, so it must check what it is widening.
    // A queue chosen since — the next title, a music queue — is the viewer's,
    // and replacing it would rearrange playback to finish a stale errand.
    const play = vi.fn().mockResolvedValue(undefined);
    const runtime = { play, stop: vi.fn(), setReturnTo: vi.fn() } as unknown as PlaybackRuntime;
    const episodes = [episode('e1', 1), episode('e2', 2)];
    let releaseSeason: (value: SeasonDetails) => void = () => {};
    const details = vi.fn().mockReturnValue(new Promise<SeasonDetails>((resolve) => { releaseSeason = resolve; }));
    const api = { details } as unknown as MediaApi;

    const { result } = harness(api, runtime);
    act(() => { result.current.startPlayback(episodes[0]); });
    act(() => { result.current.startPlayback(movie('m9')); });
    await act(async () => {
      releaseSeason(season(episodes));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.queueState?.items.map((item) => item.id)).toEqual(['m9']);
  });

  it('does not ask for a season when a queue was supplied', () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const runtime = { play, stop: vi.fn(), setReturnTo: vi.fn() } as unknown as PlaybackRuntime;
    const episodes = [episode('e1', 1), episode('e2', 2)];
    const details = vi.fn();
    const api = { details } as unknown as MediaApi;

    const { result } = harness(api, runtime);
    act(() => { result.current.openSeasonEpisode(episodes[0], episodes, 0, false); });

    expect(details).not.toHaveBeenCalled();
    expect(result.current.canNext).toBe(true);
  });
});
