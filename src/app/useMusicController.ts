import { useCallback, useState } from 'react';
import type { MediaApi } from '../api/MediaApi';
import { MusicPlaylistStore } from '../state/musicPlaylist';
import { PlaybackQueueStore, type PlaybackQueueState } from '../state/playbackQueue';
import type { MediaSummary } from '../types';

export interface StartPlaybackOptions {
  fromStart?: boolean;
  queue?: MediaSummary[];
  queueIndex?: number;
}

function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}

export function useMusicController(options: {
  api: MediaApi;
  playlistStore: MusicPlaylistStore;
  queueStore: PlaybackQueueStore;
  activePlayback: boolean;
  startPlayback: (item: MediaSummary, options?: StartPlaybackOptions) => void;
  onQueueChange: (queue: PlaybackQueueState) => void;
}) {
  const { api, playlistStore, queueStore, activePlayback, startPlayback, onQueueChange } = options;
  const [playlistEntries, setPlaylistEntries] = useState(() => playlistStore.load());

  const tracksFor = useCallback(async (item: MediaSummary): Promise<MediaSummary[]> => {
    if (item.kind === 'track') return [item];
    if (item.kind !== 'album') return [];
    const details = await api.details(item.id);
    return details.kind === 'album' && 'tracks' in details ? details.tracks : [];
  }, [api]);

  const reportFailure = (message: string) => (error: unknown) => console.error(`[macha] ${message}`, error);

  const playNow = useCallback((item: MediaSummary) => {
    void tracksFor(item).then((tracks) => {
      const first = tracks[0];
      if (first) startPlayback(first, { queue: tracks, queueIndex: 0 });
    }).catch(reportFailure('unable to start music playback'));
  }, [startPlayback, tracksFor]);

  const addToPlaylist = useCallback((item: MediaSummary) => {
    void tracksFor(item).then((tracks) => {
      if (tracks.length > 0) setPlaylistEntries(playlistStore.add(tracks));
    }).catch(reportFailure('unable to add music to playlist'));
  }, [playlistStore, tracksFor]);

  const playAlbumAll = useCallback((item: MediaSummary) => {
    void tracksFor(item).then((tracks) => {
      const first = tracks[0];
      if (!first) return;
      setPlaylistEntries(playlistStore.replace(tracks));
      startPlayback(first, { queue: tracks, queueIndex: 0 });
    }).catch(reportFailure('unable to play album'));
  }, [playlistStore, startPlayback, tracksFor]);

  const queue = useCallback(async (item: MediaSummary, placement: 'next' | 'later') => {
    const tracks = await tracksFor(item);
    const first = tracks[0];
    if (!first) return;
    const current = queueStore.load();
    if (!activePlayback || !current) {
      startPlayback(first, { queue: tracks, queueIndex: 0 });
      return;
    }
    const next = placement === 'next' ? queueStore.insertNext(tracks) : queueStore.append(tracks);
    if (next) onQueueChange(next);
  }, [activePlayback, onQueueChange, queueStore, startPlayback, tracksFor]);

  const playNext = useCallback((item: MediaSummary) => {
    void queue(item, 'next').catch(reportFailure('unable to queue music next'));
  }, [queue]);

  const playLater = useCallback((item: MediaSummary) => {
    void queue(item, 'later').catch(reportFailure('unable to queue music later'));
  }, [queue]);

  const shuffle = useCallback((item: MediaSummary) => {
    void tracksFor(item).then((tracks) => {
      const items = shuffled(tracks);
      const first = items[0];
      if (first) startPlayback(first, { queue: items, queueIndex: 0 });
    }).catch(reportFailure('unable to shuffle music'));
  }, [startPlayback, tracksFor]);

  const playPlaylist = useCallback((shuffleEntries = false, queueIndex = 0) => {
    const tracks = playlistEntries.map((entry) => entry.track);
    const items = shuffleEntries ? shuffled(tracks) : tracks;
    const boundedIndex = Math.max(0, Math.min(items.length - 1, queueIndex));
    const first = items[boundedIndex];
    if (first) startPlayback(first, { queue: items, queueIndex: boundedIndex });
  }, [playlistEntries, startPlayback]);

  const removePlaylistEntry = useCallback((entryId: string) => {
    setPlaylistEntries(playlistStore.remove(entryId));
  }, [playlistStore]);
  const movePlaylistEntry = useCallback((entryId: string, toIndex: number) => {
    setPlaylistEntries(playlistStore.move(entryId, toIndex));
  }, [playlistStore]);
  const clearPlaylist = useCallback(() => setPlaylistEntries(playlistStore.clear()), [playlistStore]);

  return {
    playlistEntries,
    playNow,
    addToPlaylist,
    playAlbumAll,
    playNext,
    playLater,
    shuffle,
    playPlaylist,
    removePlaylistEntry,
    movePlaylistEntry,
    clearPlaylist,
  };
}
