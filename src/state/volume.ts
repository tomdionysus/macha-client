import { machaHost, type MachaHost } from '@machafoundation/core';

/**
 * The read/write half of core's storage seam.
 *
 * Derived from `MachaHost` rather than restated, because core's
 * `ReadWriteStorageLike` is not exported from the package root — only the host
 * is. Deriving keeps this exactly as wide as what a store needs and cannot
 * drift from core's own shape the way a copied interface would.
 */
type VolumeStorage = Pick<MachaHost['storage'], 'getItem' | 'setItem'>;

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

/**
 * The viewer's remembered playback volume, per client.
 *
 * This was `@machafoundation/core`'s until 2026-09-13 and moved out to its two
 * real consumers — this client and Android TV — because it is not a
 * cross-client fact. What *is* cross-client is whether a host owns app-level
 * volume at all, and core keeps that as `Platform.initialVolume?()`; a
 * television's volume belongs to the television and its remote, so
 * `SamsungWebPlatform` answers 1 and never consults this store.
 *
 * **The key is `macha.volume.v1.${clientId}` and must not change.** It is the
 * same storage, the same origin and the same client id as when core owned it,
 * so a viewer's existing volume survives the move with no migration and
 * nobody notices it happened. Rename it and every viewer silently returns to
 * full volume on their next launch, which is the "comes up loud with nothing
 * explaining why" failure this whole line of work started from.
 *
 * Four behaviours are deliberate and are the easy ones to tidy away: an absent
 * key reads as **1**, not 0; an empty or whitespace-only entry reads as **1**,
 * because it is not a value at all; a stored value that is not a finite number
 * reads as **1**; and `save` returns the value actually stored rather than the
 * one asked for, so a caller can render what happened instead of what it
 * requested. A stored `0` is none of these — it is a viewer who chose silence,
 * and it keeps meaning silence.
 */
export class VolumeStore {
  private readonly key: string;

  constructor(clientId: string, private readonly storage: VolumeStorage = machaHost().storage) {
    this.key = `macha.volume.v1.${clientId}`;
  }

  load(): number {
    const raw = this.storage.getItem(this.key);
    // An empty or whitespace-only entry is not a volume — it is a corrupted or
    // half-written one, and it must not be read as a choice. `Number('')` is
    // `0`, and `0` is finite, so without this line the clamp accepts it and a
    // viewer's next launch is silent with nothing explaining why. `0` itself
    // stays a legitimate stored value: a viewer who mutes stays muted. The
    // difference is a value someone chose against no value at all, which is why
    // this belongs on the parse and not on the clamp.
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
