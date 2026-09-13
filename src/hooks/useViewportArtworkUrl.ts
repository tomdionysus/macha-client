import { useEffect, useState } from 'react';
import type { MediaApi } from '@machafoundation/core';
import type { ArtworkRef } from '@machafoundation/core';
import { fetchArtworkWithRetry } from './artworkRetry';
import { observeArtworkProximity } from './artworkViewport';
import { createClientLogger } from '@machafoundation/core';

export const VISIBLE_ARTWORK_RECOVERY_DELAY_MS = 60_000;
const log = createClientLogger('artwork.view');

/**
 * Load artwork once its host approaches the viewport.
 *
 * The network side is intentionally fire-and-finish. We never abort an artwork
 * request because a card scrolled away or unmounted: MachaMediaApi coalesces
 * unsignalled requests and caches the resulting Blob, so completing useful work
 * is both simpler and more reliable than trying to reprioritise browser HTTP.
 */
export function useViewportArtworkUrl(
  api: MediaApi,
  ref: ArtworkRef | undefined,
  element: HTMLElement | null,
  eager = false,
  retryKey = 0,
): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    setUrl(undefined);
    if (!ref) return;
    const artwork = ref;

    let active = true;
    let objectUrl: string | undefined;
    let stopObserving: (() => void) | undefined;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;

    const arm = () => {
      if (!active) return;
      if (eager || typeof window === 'undefined') {
        load();
      } else if (element) {
        stopObserving = observeArtworkProximity(element, load);
      }
    };

    function load() {
      stopObserving = undefined;
      // No AbortSignal here by design. Once viewport demand exists, the request
      // is allowed to finish and populate MediaApi's shared cache even if this
      // particular card disappears before the response arrives.
      void fetchArtworkWithRetry(() => api.artwork(artwork)).then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }).catch((error) => {
        if (!active) return;
        setUrl(undefined);
        log.warn('load-cycle-exhausted', {
          artworkId: artwork.id,
          retryInMs: VISIBLE_ARTWORK_RECOVERY_DELAY_MS,
          error,
        });
        // A mounted card gets another bounded cycle, but only after a quiet
        // period and only once it is near the viewport again.
        recoveryTimer = setTimeout(() => {
          recoveryTimer = undefined;
          if (!active) return;
          log.info('load-cycle-rearmed', { artworkId: artwork.id });
          arm();
        }, VISIBLE_ARTWORK_RECOVERY_DELAY_MS);
      });
    }

    arm();

    return () => {
      active = false;
      stopObserving?.();
      if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, eager, element, ref?.id, retryKey]);

  return url;
}
