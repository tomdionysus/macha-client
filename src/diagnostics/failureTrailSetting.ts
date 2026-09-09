import { machaHost } from '@macha/core';

/**
 * Whether the playback failure screen prints the evidence behind a failure, or
 * only the message.
 *
 * **Off by default, deliberately.** The trail is a dozen lines of scope, event
 * and truncated JSON: exactly right in front of whoever is debugging a
 * television that has no console, and exactly wrong in front of everyone else,
 * who wanted to know their film stopped and not why the third node refused a
 * fragment. Diagnostics that are on by default stop being diagnostics and
 * start being the product.
 *
 * Read at the moment a failure lands rather than subscribed to, because that
 * is the only moment it is consulted — turning it on mid-failure to inspect a
 * failure already on screen is not a case worth carrying state for.
 */
const FAILURE_TRAIL_KEY = 'macha-playback-failure-trail-v1';

/** Storage can throw outright — a private window, a widget with no quota — and
 * neither a settings screen nor a player is worth failing over a preference.
 * Absent and unreadable both mean off, which is also the default. */
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
