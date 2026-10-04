import { machaHost } from '@machafoundation/core';

/**
 * Whether the playback failure screen prints the evidence behind a failure or only the message.
 * Off by default: the trail is for debugging a device with no console. Read when a failure lands.
 */
const FAILURE_TRAIL_KEY = 'macha-playback-failure-trail-v1';

/** Storage can throw (a private window, no quota); absent and unreadable both mean off. */
export function failureTrailEnabled(): boolean {
  try {
    return machaHost().storage.getItem(FAILURE_TRAIL_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setFailureTrailEnabled(enabled: boolean): void {
  try {
    const storage = machaHost().storage;
    if (enabled) storage.setItem(FAILURE_TRAIL_KEY, 'on');
    else storage.removeItem(FAILURE_TRAIL_KEY);
  } catch {
    // The control still governs this session; only the memory of it is lost.
  }
}
