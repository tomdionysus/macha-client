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
  /**
   * The whole reason the move needed no migration. This store came out of
   * `@machafoundation/core` on 2026-09-13 keeping the same storage, the same
   * origin and the same client id — so a viewer's existing volume is still
   * there. A renamed key would silently reset every viewer to full volume on
   * their next launch, with nothing on screen explaining why.
   */
  it('reads the key core wrote, so a viewer keeps the volume they had', () => {
    const storage = fakeStorage({ 'macha.volume.v1.viewer-1': '0.25' });
    expect(new VolumeStore('viewer-1', storage).load()).toBe(0.25);
  });

  it('keeps volumes apart per client', () => {
    const storage = fakeStorage({ 'macha.volume.v1.a': '0.2', 'macha.volume.v1.b': '0.8' });
    expect(new VolumeStore('a', storage).load()).toBe(0.2);
    expect(new VolumeStore('b', storage).load()).toBe(0.8);
  });

  // Silence is the wrong default for "we have never asked": a viewer who has
  // set nothing wants the film audible, not muted with no clue why.
  it('starts at full volume when nothing has been stored', () => {
    expect(new VolumeStore('fresh', fakeStorage()).load()).toBe(1);
  });

  it('starts at full volume when the stored value is not a number', () => {
    expect(new VolumeStore('v', fakeStorage({ 'macha.volume.v1.v': 'loud' })).load()).toBe(1);
    expect(new VolumeStore('v', fakeStorage({ 'macha.volume.v1.v': 'null' })).load()).toBe(1);
  });

  /**
   * `Number('')` is `0`, and `0` is finite, so without an explicit guard an
   * empty entry reads as a deliberate mute — the one input that produces
   * exactly the "comes up silent with nothing explaining why" failure this
   * store exists to prevent. An empty string is not a volume; it is a
   * corrupted or half-written entry.
   *
   * Copied faithfully from `@machafoundation/core` first and recorded as a
   * test before being changed, so the move and the behaviour change are not
   * the same commit. Agreed with the `Macha NPM Core` session 2026-09-13 and
   * Android TV is matching it — this client and Android TV hold separate
   * copies now, so divergence here would be invisible until a viewer's storage
   * reached that state.
   */
  it('treats an empty or whitespace-only entry as absent, not as silence', () => {
    expect(new VolumeStore('v', fakeStorage({ 'macha.volume.v1.v': '' })).load()).toBe(1);
    expect(new VolumeStore('v', fakeStorage({ 'macha.volume.v1.v': '   ' })).load()).toBe(1);
  });

  // The other half of that decision: a stored zero is a viewer who chose
  // silence, and it must keep meaning silence.
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
