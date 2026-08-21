import { describe, expect, it } from 'vitest';
import { MusicPlaylistStore } from './musicPlaylist';
class MemoryStorage {
    values = new Map();
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, value); }
    removeItem(key) { this.values.delete(key); }
}
const track = (id) => ({
    id,
    kind: 'track',
    title: id,
    mediaIds: [`media:${id}`],
});
describe('MusicPlaylistStore', () => {
    it('persists duplicate tracks as distinct ordered entries', () => {
        const storage = new MemoryStorage();
        const store = new MusicPlaylistStore('client', storage);
        const entries = store.add([track('one'), track('one')]);
        expect(entries.map((entry) => entry.track.id)).toEqual(['one', 'one']);
        expect(entries[0]?.entryId).not.toBe(entries[1]?.entryId);
        expect(new MusicPlaylistStore('client', storage).load()).toHaveLength(2);
    });
    it('replaces the saved playlist when an album is loaded for Play all', () => {
        const storage = new MemoryStorage();
        const store = new MusicPlaylistStore('client', storage);
        store.add([track('old')]);
        const replaced = store.replace([track('one'), track('two')]);
        expect(replaced.map((entry) => entry.track.id)).toEqual(['one', 'two']);
        expect(new MusicPlaylistStore('client', storage).load().map((entry) => entry.track.id)).toEqual(['one', 'two']);
    });
    it('moves and removes individual entries by stable entry id', () => {
        const storage = new MemoryStorage();
        const store = new MusicPlaylistStore('client', storage);
        const entries = store.add([track('one'), track('two'), track('three')]);
        const third = entries[2];
        if (!third)
            throw new Error('expected third playlist entry');
        const moved = store.move(third.entryId, 0);
        expect(moved.map((entry) => entry.track.id)).toEqual(['three', 'one', 'two']);
        const removed = store.remove(third.entryId);
        expect(removed.map((entry) => entry.track.id)).toEqual(['one', 'two']);
    });
    it('discards malformed persisted data', () => {
        const storage = new MemoryStorage();
        storage.setItem('macha.musicPlaylist.v1.client', '[{"entryId":"bad","track":{"kind":"movie"}}]');
        expect(new MusicPlaylistStore('client', storage).load()).toEqual([]);
    });
});
