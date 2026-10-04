import { useEffect, useState } from 'react';
import type { MediaApi } from '@machafoundation/core';
import type { ArtworkRef } from '@machafoundation/core';
import { fetchArtworkWithRetry } from './artworkRetry';
import { observeArtworkProximity } from './artworkViewport';
import { createClientLogger } from '@machafoundation/core';

export const VISIBLE_ARTWORK_RECOVERY_DELAY_MS = 60_000;
const log = createClientLogger('artwork.view');

/**
 * Loads artwork once its host nears the viewport. Requests are never aborted: MachaMediaApi
 * coalesces them and caches the Blob, so a finished request serves the next card.
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
      // No AbortSignal: see the hook's doc.
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
        // Retry after a quiet period, and only once near the viewport again.
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
