import { describe, expect, it } from 'vitest';
import { VolumeStore } from './volume';

function fakeStorage(seed?: Record<string, string>) {
  const values = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('VolumeStore', () => {
  // The key core wrote: a renamed key would silently reset every viewer to full volume.
  it('reads the key core wrote, so a viewer keeps the volume they had', () => {
    const storage = fakeStorage({ 'macha.volume.v1.viewer-1': '0.25' });
    expect(new VolumeStore('viewer-1', storage).load()).toBe(0.25);
  });

  it('keeps volumes apart per client', () => {
    const storage = fakeStorage({ 'macha.volume.v1.a': '0.2', 'macha.volume.v1.b': '0.8' });
    expect(new VolumeStore('a', storage).load()).toBe(0.2);
    expect(new VolumeStore('b', storage).load()).toBe(0.8);
  });

  it('starts at full volume when nothing has been stored', () => {
    expect(new VolumeStore('fresh', fakeStorage()).load()).toBe(1);
  });

  it('starts at full volume when the stored value is not a number', () => {
    expect(new VolumeStore('v', fakeStorage({ 'macha.volume.v1.v': 'loud' })).load()).toBe(1);
    expect(new VolumeStore('v', fakeStorage({ 'macha.volume.v1.v': 'null' })).load()).toBe(1);
  });

  // `Number('')` is 0 and finite, so an unguarded empty entry would read as a
  // mute. Android TV's copy of this store has the same rule.
  it('treats an empty or whitespace-only entry as absent, not as silence', () => {
    expect(new VolumeStore('v', fakeStorage({ 'macha.volume.v1.v': '' })).load()).toBe(1);
    expect(new VolumeStore('v', fakeStorage({ 'macha.volume.v1.v': '   ' })).load()).toBe(1);
  });

  it('keeps a stored zero as the mute a viewer chose', () => {
    expect(new VolumeStore('v', fakeStorage({ 'macha.volume.v1.v': '0' })).load()).toBe(0);
  });

  it('clamps what it stores, and returns what was actually stored', () => {
    const storage = fakeStorage();
    const store = new VolumeStore('v', storage);
    expect(store.save(1.5)).toBe(1);
    expect(store.save(-2)).toBe(0);
    expect(store.save(Number.NaN)).toBe(1);
    expect(store.save(0.4)).toBe(0.4);
    expect(storage.values.get('macha.volume.v1.v')).toBe('0.4');
  });

  it('clamps a stored value that is out of range rather than trusting it', () => {
    expect(new VolumeStore('v', fakeStorage({ 'macha.volume.v1.v': '7' })).load()).toBe(1);
    expect(new VolumeStore('v', fakeStorage({ 'macha.volume.v1.v': '-3' })).load()).toBe(0);
  });
});
