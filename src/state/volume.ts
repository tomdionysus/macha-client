import { machaHost, type MachaHost } from '@machafoundation/core';

/** Derived from `MachaHost` because core does not export its read/write storage type. */
type VolumeStorage = Pick<MachaHost['storage'], 'getItem' | 'setItem'>;

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

/**
 * The viewer's remembered playback volume, per client. A host that owns its own
 * volume answers `Platform.initialVolume?()` and never consults this.
 *
 * The key `macha.volume.v1.${clientId}` is the one core wrote and must not
 * change, or every viewer returns to full volume. An absent, blank or
 * non-numeric entry reads as 1; a stored 0 is a chosen mute and stays 0.
 * `save` returns the value actually stored.
 */
export class VolumeStore {
  private readonly key: string;

  constructor(clientId: string, private readonly storage: VolumeStorage = machaHost().storage) {
    this.key = `macha.volume.v1.${clientId}`;
  }

  load(): number {
    const raw = this.storage.getItem(this.key);
    // `Number('')` is 0, so a blank entry must be caught here or it reads as a mute.
    if (raw === null || raw.trim() === '') return 1;
    const value = Number(raw);
    return Number.isFinite(value) ? clampVolume(value) : 1;
  }

  save(volume: number): number {
    const value = clampVolume(volume);
    this.storage.setItem(this.key, String(value));
    return value;
  }
}
