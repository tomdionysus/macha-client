import { describe, expect, it } from 'vitest';
import type { MediaSummary } from '../types';
import { PlaybackQueueStore } from './playbackQueue';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const track = (id: string): MediaSummary => ({
  id,
  kind: 'track',
  title: id,
  mediaIds: [`media:${id}`],
});

describe('PlaybackQueueStore', () => {
  it('persists queue contents and the selected item', () => {
    const storage = new MemoryStorage();
    const store = new PlaybackQueueStore('client', storage);
    store.replace([track('one'), track('two'), track('three')], 1);

    expect(new PlaybackQueueStore('client', storage).load()).toMatchObject({
      currentIndex: 1,
      positionMs: 0,
      items: [{ id: 'one' }, { id: 'two' }, { id: 'three' }],
    });
  });

  it('updates only the current queue index when advancing', () => {
    const storage = new MemoryStorage();
    const store = new PlaybackQueueStore('client', storage);
    store.replace([track('one'), track('two')], 0);
    const next = store.select(1);

    expect(next?.currentIndex).toBe(1);
    expect(next?.items.map((item) => item.id)).toEqual(['one', 'two']);
  });

  it('persists the current item position without changing the queue', () => {
    const storage = new MemoryStorage();
    const store = new PlaybackQueueStore('client', storage);
    store.replace([track('one'), track('two')], 1);
    const next = store.updatePosition(42_500);

    expect(next?.positionMs).toBe(42_500);
    expect(next?.currentIndex).toBe(1);
    expect(next?.items.map((item) => item.id)).toEqual(['one', 'two']);
  });

  it('discards malformed persisted state', () => {
    const storage = new MemoryStorage();
    storage.setItem('macha.playbackQueue.v1.client', '{"items":[],"currentIndex":99}');
    expect(new PlaybackQueueStore('client', storage).load()).toBeUndefined();
  });
});
