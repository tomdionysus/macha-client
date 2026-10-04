// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaApi } from '@machafoundation/core';
import type { Platform } from '@machafoundation/core';
import type { PlaybackRuntime, PlaybackRuntimeRequest, PlaybackRuntimeSnapshot } from '@machafoundation/core';
import { ContinueWatchingStore } from '@machafoundation/core';
import { PlaybackQueueStore } from '@machafoundation/core';
import { VolumeStore } from '../state/volume';
import type { MediaSummary } from '@machafoundation/core';
import { AppRouter } from './AppRouter';
import { usePlaybackController } from './usePlaybackController';

function movie(id: string): MediaSummary {
  return { id, kind: 'movie', title: id, mediaIds: [`file:${id}`], durationMs: 600_000 };
}

/** Like the real runtime, play() notifies subscribers synchronously, before it returns; a later-tick fake would batch differently and hide the flash. */
class SynchronousRuntime {
  private snapshot: PlaybackRuntimeSnapshot = { phase: 'idle', generation: 0 };
  private readonly listeners = new Set<(state: PlaybackRuntimeSnapshot) => void>();

  subscribe(listener: (state: PlaybackRuntimeSnapshot) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  play = vi.fn((request: PlaybackRuntimeRequest): Promise<void> => {
    this.snapshot = { phase: 'starting', generation: this.snapshot.generation + 1, request };
    for (const listener of [...this.listeners]) listener(this.snapshot);
    return Promise.resolve();
  });

  stop = vi.fn().mockResolvedValue(undefined);
  setReturnTo = vi.fn();
  getSnapshot() { return this.snapshot; }
}

describe('presentation while playback is starting', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/movies');
  });

  it('never renders the player visible before the player route is active', () => {
    // A render with playback visible before `/play/:id` arrives flashes the mini bar.
    // The router publishes locations in `React.startTransition` by default, which the
    // runtime's setState would outrun; AppRouter turns that off.
    const runtime = new SynchronousRuntime();
    const api = { details: vi.fn() } as unknown as MediaApi;
    const progressStore = new ContinueWatchingStore('test-client');
    const queueStore = new PlaybackQueueStore('test-client');
    const volumeStore = new VolumeStore('test-client');
    const renders: Array<{ visible: boolean; routeActive: boolean }> = [];
    let startPlayback: (item: MediaSummary) => void = () => {};

    function Probe() {
      const [runtimeState, setRuntimeState] = useState<PlaybackRuntimeSnapshot>(() => runtime.getSnapshot());
      useEffect(() => runtime.subscribe(setRuntimeState), []);
      const playback = usePlaybackController({
        api,
        platform: {} as unknown as Platform,
        runtime: runtime as unknown as PlaybackRuntime,
        runtimeState,
        progressStore,
        queueStore,
        volumeStore,
        ready: true,
      });
      renders.push({ visible: playback.playerVisible, routeActive: playback.playerRouteActive });
      startPlayback = playback.startPlayback;
      return null;
    }

    render(<AppRouter><Probe /></AppRouter>);
    act(() => { startPlayback(movie('m1')); });

    expect(runtime.play).toHaveBeenCalledTimes(1);
    expect(renders.some((frame) => frame.visible && frame.routeActive)).toBe(true);
    expect(renders.filter((frame) => frame.visible && !frame.routeActive)).toEqual([]);
  });
});
