import { beforeEach, describe, expect, it } from 'vitest';
import { configureMachaHost, type StorageLike } from '@machafoundation/core';
import { failureTrailEnabled, setFailureTrailEnabled } from './failureTrailSetting';

function memoryStorage(): StorageLike & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
    removeItem: (key) => { entries.delete(key); },
  };
}

describe('showing diagnostics on a playback failure', () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
    configureMachaHost({ storage });
  });

  it('is off until someone asks for it, and forgets rather than remembering "off"', () => {
    expect(failureTrailEnabled()).toBe(false);

    setFailureTrailEnabled(true);
    expect(failureTrailEnabled()).toBe(true);

    setFailureTrailEnabled(false);
    expect(failureTrailEnabled()).toBe(false);
    // Turning it off leaves nothing behind, so a viewer who never touched it
    // and one who tried it once are the same viewer to everything downstream.
    expect(storage.entries.size).toBe(0);
  });

  it('stays off rather than throwing where storage itself throws', () => {
    // A private window or a widget with no quota. Neither a settings screen
    // nor a player is worth failing over a preference.
    configureMachaHost({
      storage: {
        getItem: () => { throw new Error('storage is unavailable'); },
        setItem: () => { throw new Error('storage is unavailable'); },
        removeItem: () => { throw new Error('storage is unavailable'); },
      },
    });

    expect(failureTrailEnabled()).toBe(false);
    expect(() => setFailureTrailEnabled(true)).not.toThrow();
  });
});
