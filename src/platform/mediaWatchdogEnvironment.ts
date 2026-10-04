import type { MediaWatchdogEnvironment } from '@machafoundation/core';

/** The browser's side of core's media watchdogs: the clock, and whether anyone can see the page. */
export const browserMediaWatchdogEnvironment: MediaWatchdogEnvironment = {
  now: () => Date.now(),
  visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  // A host that cannot report visibility counts as always visible, so the bound
  // stays in force. Must agree with the `undefined` check in `visible`.
  onVisibilityChange: (listener) => {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
      return () => undefined;
    }
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener?.('visibilitychange', listener);
  },
  schedule: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};
