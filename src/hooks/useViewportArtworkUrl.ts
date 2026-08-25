import { useEffect, useState } from 'react';
import type { MediaApi } from '../api/MediaApi';
import type { ArtworkRef } from '../types';
import { fetchArtworkWithRetry } from './artworkRetry';
import { observeArtworkProximity } from './artworkViewport';

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
): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    setUrl(undefined);
    if (!ref) return;

    let active = true;
    let objectUrl: string | undefined;
    let started = false;

    const load = () => {
      if (started) return;
      started = true;
      // No AbortSignal here by design. Once viewport demand exists, the request
      // is allowed to finish and populate MediaApi's shared cache even if this
      // particular card disappears before the response arrives.
      void fetchArtworkWithRetry(() => api.artwork(ref)).then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }).catch(() => {
        if (active) setUrl(undefined);
      });
    };

    let stopObserving: (() => void) | undefined;
    if (eager || typeof window === 'undefined') {
      load();
    } else if (element) {
      stopObserving = observeArtworkProximity(element, load);
    }

    return () => {
      active = false;
      stopObserving?.();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, eager, element, ref?.id]);

  return url;
}
