import type { MediaWatchdogEnvironment } from '@machafoundation/core';

/**
 * The browser's answers to the four questions `@machafoundation/core`'s media watchdogs
 * ask, kept here because they are the only DOM in that mechanism.
 *
 * The rules — visible time only, zero bytes versus slow, slow versus dead —
 * are platform-independent and live in core. What a page cannot tell core is
 * whether anyone is looking at it, and that is all this supplies.
 */
export const browserMediaWatchdogEnvironment: MediaWatchdogEnvironment = {
  now: () => Date.now(),
  visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  // A host that cannot report visibility is treated as permanently visible, so
  // the bound stays in force rather than being silently disabled by a missing
  // API. The `undefined` check above and this one are the same decision and
  // have to agree: guarding only one of them leaves the module claiming not to
  // require a DOM while still throwing on hosts that do not fully provide one.
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
