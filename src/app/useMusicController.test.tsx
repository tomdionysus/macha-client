// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MachaSavedRowLimitError, type MediaApi, type MediaSummary, type MusicPlaylistStore, type PlaybackQueueStore } from '@machafoundation/core';
import { useMusicController } from './useMusicController';
import { PLAYLIST_TOO_LARGE_TEXT } from '../text/viewerText';
import { settle } from '../test/settle';

const track: MediaSummary = { id: 't1', kind: 'track', title: 'A Song', mediaIds: ['file:t1'] };

function setup(refuse: boolean) {
  const refusal = () => { throw new MachaSavedRowLimitError('macha.playlist', 2_000_000, 1_048_576); };
  const playlistStore = {
    load: () => [],
    add: vi.fn(refuse ? refusal : () => [{ id: 'e1', track }]),
    replace: vi.fn(refuse ? refusal : () => [{ id: 'e1', track }]),
  } as unknown as MusicPlaylistStore;
  const startPlayback = vi.fn();
  const hook = renderHook(() => useMusicController({
    api: {} as MediaApi,
    playlistStore,
    queueStore: {} as PlaybackQueueStore,
    activePlayback: false,
    startPlayback,
    onQueueChange: vi.fn(),
  }));
  return { hook, startPlayback };
}

describe('a playlist too large to save', () => {
  it('tells the viewer when an add is refused, and keeps the list as it was', async () => {
    const { hook } = setup(true);
    act(() => hook.result.current.addToPlaylist(track));
    await act(settle);
    expect(hook.result.current.playlistNotice).toBe(PLAYLIST_TOO_LARGE_TEXT);
    expect(hook.result.current.playlistEntries).toEqual([]);
  });

  it('still plays on Play all when the playlist cannot be saved', async () => {
    const { hook, startPlayback } = setup(true);
    act(() => hook.result.current.playAlbumAll(track));
    await act(settle);
    expect(startPlayback).toHaveBeenCalledWith(track, { queue: [track], queueIndex: 0 });
    expect(hook.result.current.playlistNotice).toBe(PLAYLIST_TOO_LARGE_TEXT);
  });

  it('says nothing when the save succeeds', async () => {
    const { hook } = setup(false);
    act(() => hook.result.current.addToPlaylist(track));
    await act(settle);
    expect(hook.result.current.playlistNotice).toBeUndefined();
    expect(hook.result.current.playlistEntries).toHaveLength(1);
  });
});
