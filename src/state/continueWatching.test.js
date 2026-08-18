import { describe, expect, it } from 'vitest';
import { ContinueWatchingStore, isFinished } from './continueWatching';
class MemoryStorage {
    values = new Map();
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.get(key) ?? null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, value); }
}
function progress(mediaId, positionMs, durationMs = 100_000, updatedAt = positionMs) {
    return {
        mediaId,
        positionMs,
        durationMs,
        updatedAt,
        media: { id: mediaId, kind: 'movie', title: mediaId, durationMs, mediaIds: [mediaId] },
    };
}
describe('ContinueWatchingStore', () => {
    it('keeps only the three most recent playable items', () => {
        const store = new ContinueWatchingStore('client', new MemoryStorage());
        store.update(progress('one', 31_000, 100_000, 1));
        store.update(progress('two', 32_000, 100_000, 2));
        store.update(progress('three', 33_000, 100_000, 3));
        store.update(progress('four', 34_000, 100_000, 4));
        expect(store.list().map((entry) => entry.mediaId)).toEqual(['four', 'three', 'two']);
    });
    it('does not clutter continue watching with accidental starts', () => {
        const store = new ContinueWatchingStore('client', new MemoryStorage());
        store.update(progress('one', 10_000));
        expect(store.list()).toEqual([]);
    });
    it('explicitly removes only the requested item', () => {
        const store = new ContinueWatchingStore('client', new MemoryStorage());
        store.update(progress('one', 50_000, 100_000, 1));
        store.update(progress('two', 50_000, 100_000, 2));
        expect(store.clear('two').map((entry) => entry.mediaId)).toEqual(['one']);
        expect(store.list().map((entry) => entry.mediaId)).toEqual(['one']);
    });
    it('removes media once it is effectively finished', () => {
        const store = new ContinueWatchingStore('client', new MemoryStorage());
        store.update(progress('one', 50_000));
        store.update(progress('one', 95_000));
        expect(store.list()).toEqual([]);
    });
    it('uses a 92% completion threshold', () => {
        expect(isFinished(progress('one', 91_999))).toBe(false);
        expect(isFinished(progress('one', 92_000))).toBe(true);
    });
});
