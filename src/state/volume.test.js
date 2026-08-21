import { describe, expect, it } from 'vitest';
import { VolumeStore } from './volume';
class MemoryStorage {
    values = new Map();
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, value); }
}
describe('VolumeStore', () => {
    it('defaults to full volume and persists client-local changes', () => {
        const storage = new MemoryStorage();
        const store = new VolumeStore('client', storage);
        expect(store.load()).toBe(1);
        expect(store.save(0.35)).toBe(0.35);
        expect(new VolumeStore('client', storage).load()).toBe(0.35);
    });
    it('clamps persisted volume to the player range', () => {
        const storage = new MemoryStorage();
        const store = new VolumeStore('client', storage);
        expect(store.save(2)).toBe(1);
        expect(store.save(-1)).toBe(0);
    });
});
