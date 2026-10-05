// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { MediaApi } from '@machafoundation/core';
import type { Platform } from '@machafoundation/core';
import type { PlaybackRuntime, PlaybackRuntimeSnapshot } from '@machafoundation/core';
import { ContinueWatchingStore } from '@machafoundation/core';
import { PlaybackQueueStore } from '@machafoundation/core';
import { VolumeStore } from '../state/volume';
import type { Episode, MediaSummary, PlaybackProgress, SeasonDetails, VersionStep } from '@machafoundation/core';
import { resumePreferences, versionPreferences } from '@machafoundation/core';
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

/** A stalled snapshot: play() was called but the runtime has not yet published a matching request. */
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
    // Constructed once: a fresh store per render would retrigger every effect keyed on it.
    const progressStore = new ContinueWatchingStore('test-client');
    const queueStore = new PlaybackQueueStore('test-client');
    const volumeStore = new VolumeStore('test-client');

    const { result } = renderHook(
      (runtimeState: PlaybackRuntimeSnapshot) => usePlaybackController({
        api, platform, runtime, runtimeState, progressStore, queueStore, volumeStore, ready: true,
      }),
      {
        initialProps: stalledSnapshot(),
        wrapper: ({ children }) => <MemoryRouter initialEntries={['/movies']}>{children}</MemoryRouter>,
      },
    );

    act(() => {
      result.current.startPlayback(movie('m1'));
    });

    // The route-reconstruction effect also ran; the explicit-start guard must suppress it.
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
        api, platform, runtime, runtimeState: stalledSnapshot(), progressStore, queueStore, volumeStore, ready: true,
      }),
      { wrapper: ({ children }) => <MemoryRouter initialEntries={['/play/m2']}>{children}</MemoryRouter> },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(details).toHaveBeenCalledWith('m2');
    expect(play).toHaveBeenCalledTimes(1);
  });

  // Facts requested before a session exists go out bare, take a 401, and the coordinator chooses blind.
  it('does not reconstruct from the URL before the client has an endpoint', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const runtime = { play, stop: vi.fn(), setReturnTo: vi.fn() } as unknown as PlaybackRuntime;
    const details = vi.fn().mockResolvedValue(movie('m3'));
    const api = { details } as unknown as MediaApi;
    const progressStore = new ContinueWatchingStore('test-client');
    const queueStore = new PlaybackQueueStore('test-client');
    const volumeStore = new VolumeStore('test-client');

    const { rerender } = renderHook(
      (ready: boolean) => usePlaybackController({
        api, platform, runtime, runtimeState: stalledSnapshot(), progressStore, queueStore, volumeStore, ready,
      }),
      {
        initialProps: false,
        wrapper: ({ children }) => <MemoryRouter initialEntries={['/play/m3']}>{children}</MemoryRouter>,
      },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(play).not.toHaveBeenCalled();
    expect(details).not.toHaveBeenCalled();

    // A hold, not a refusal: the same reload plays once there is an endpoint.
    rerender(true);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(details).toHaveBeenCalledWith('m3');
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
        api, platform, runtime, runtimeState: stalledSnapshot(), progressStore, queueStore, volumeStore, ready: true,
      }),
      { wrapper: ({ children }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter> },
    );
  }

  it('widens a lone episode into its season so the transport has next and previous', async () => {
    // Resuming from Continue Watching passes no queue.
    const play = vi.fn().mockResolvedValue(undefined);
    const runtime = { play, stop: vi.fn(), setReturnTo: vi.fn() } as unknown as PlaybackRuntime;
    const episodes = [episode('e1', 1), episode('e2', 2), episode('e3', 3)];
    const details = vi.fn().mockResolvedValue(season(episodes));
    const api = { details } as unknown as MediaApi;

    const { result } = harness(api, runtime);
    act(() => { result.current.startPlayback(episodes[1]); });

    // Playback starts on the single item; the siblings arrive behind it.
    expect(play).toHaveBeenCalledTimes(1);
    expect(result.current.canNext).toBe(false);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(details).toHaveBeenCalledWith('season1');
    expect(result.current.queueState?.items.map((item) => item.id)).toEqual(['e1', 'e2', 'e3']);
    expect(result.current.queueState?.currentIndex).toBe(1);
    expect(result.current.canPrevious).toBe(true);
    expect(result.current.canNext).toBe(true);
    // Widening must not restart playback.
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('leaves a queue the viewer built alone', async () => {
    // The season arrives late, so it must not replace a queue chosen since.
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
    act(() => { result.current.startPlayback(episodes[0], { queue: episodes, queueIndex: 0 }); });

    expect(details).not.toHaveBeenCalled();
    expect(result.current.canNext).toBe(true);
  });

  it("starts a picked quality as the viewer's choice, and Play as core's", () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const runtime = { play, stop: vi.fn(), setReturnTo: vi.fn() } as unknown as PlaybackRuntime;
    const api = { details: vi.fn() } as unknown as MediaApi;
    const progressStore = new ContinueWatchingStore('test-client');
    const queueStore = new PlaybackQueueStore('test-client');
    const volumeStore = new VolumeStore('test-client');
    const { result } = renderHook(
      () => usePlaybackController({ api, platform, runtime, runtimeState: stalledSnapshot(), progressStore, queueStore, volumeStore, ready: true }),
      { wrapper: ({ children }) => <MemoryRouter initialEntries={['/movies']}>{children}</MemoryRouter> },
    );
    const version: VersionStep = {
      quality: 720,
      source: 'transcode',
      mediaId: 'file:m1',
      instruction: { mode: 'transcode', video: 'transcode', audio: 'transcode', container: 'fmp4', reasons: [], assumed: [] },
      maxHeight: 534,
    };

    act(() => { result.current.startPlayback(movie('m1'), { version }); });
    expect(play).toHaveBeenLastCalledWith(expect.objectContaining({ media: movie('m1') }), versionPreferences(version));
    expect(play.mock.lastCall?.[1]).toMatchObject({ mode: 'transcode', maxHeight: 534, mediaId: 'file:m1' });

    act(() => { result.current.startPlayback(movie('m2')); });
    expect(play.mock.lastCall?.[1]).toBeUndefined();
  });

  it("resumes a title as it was playing, unless started from the beginning or at a picked quality", () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const runtime = { play, stop: vi.fn(), setReturnTo: vi.fn() } as unknown as PlaybackRuntime;
    const api = { details: vi.fn() } as unknown as MediaApi;
    const progressStore = new ContinueWatchingStore('test-client');
    const queueStore = new PlaybackQueueStore('test-client');
    const volumeStore = new VolumeStore('test-client');
    const saved: PlaybackProgress = {
      itemId: 'm1', fileMediaId: 'macha:uhd', positionMs: 120_000, durationMs: 600_000, updatedAt: Date.now(), media: movie('m1'),
      resume: { chosenByViewer: true, mode: 'transcode', container: 'fmp4', maxHeight: 720, audioStream: 2, subtitleStream: 4 },
    };
    progressStore.update(saved);
    const { result } = renderHook(
      () => usePlaybackController({ api, platform, runtime, runtimeState: stalledSnapshot(), progressStore, queueStore, volumeStore, ready: true }),
      { wrapper: ({ children }) => <MemoryRouter initialEntries={['/movies']}>{children}</MemoryRouter> },
    );

    act(() => { result.current.startPlayback(movie('m1')); });
    expect(play).toHaveBeenLastCalledWith(expect.objectContaining({ startPositionMs: 120_000 }), resumePreferences(saved));
    expect(play.mock.lastCall?.[1]).toMatchObject({ mediaId: 'macha:uhd', mode: 'transcode', maxHeight: 720, audioStream: 2, subtitleStream: 4 });

    act(() => { result.current.startPlayback(movie('m1'), { fromStart: true }); });
    expect(play.mock.lastCall?.[1]).toBeUndefined();
  });
});


describe('unavailable titles', () => {
  beforeEach(() => localStorage.clear());

  function controller() {
    const play = vi.fn().mockResolvedValue(undefined);
    const runtime = { play, stop: vi.fn(), setReturnTo: vi.fn() } as unknown as PlaybackRuntime;
    const api = { details: vi.fn() } as unknown as MediaApi;
    const progressStore = new ContinueWatchingStore('test-client');
    const queueStore = new PlaybackQueueStore('test-client');
    const volumeStore = new VolumeStore('test-client');
    const { result } = renderHook(
      (runtimeState: PlaybackRuntimeSnapshot) => usePlaybackController({
        api, platform, runtime, runtimeState, progressStore, queueStore, volumeStore, ready: true,
      }),
      { initialProps: stalledSnapshot(), wrapper: ({ children }) => <MemoryRouter initialEntries={['/movies']}>{children}</MemoryRouter> },
    );
    return { result, play, queueStore };
  }

  it('never starts one', () => {
    const { result, play } = controller();
    act(() => { result.current.startPlayback({ ...movie('m1'), availability: 'unavailable' }); });
    expect(play).not.toHaveBeenCalled();
  });

  it('leaves them out of a queue, keeping the place of the one started, and plays partial and unknown ones', () => {
    const { result, play, queueStore } = controller();
    const queue = [
      { ...episode('e1', 1), availability: 'unavailable' },
      { ...episode('e2', 2), availability: 'partial' },
      { ...episode('e3', 3), availability: 'unavailable' },
      { ...episode('e4', 4), availability: 'unknown' },
    ];
    act(() => { result.current.startPlayback(queue[1], { queue, queueIndex: 1 }); });
    expect(play).toHaveBeenCalledTimes(1);
    const stored = queueStore.load();
    expect(stored?.items.map((item) => item.id)).toEqual(['e2', 'e4']);
    expect(stored?.currentIndex).toBe(0);
  });
});
