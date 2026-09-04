import { useEffect, useState } from 'react';
import type { MediaApi } from '../api/MediaApi';
import type { ArtworkRef } from '../types';
import { fetchArtworkWithRetry } from './artworkRetry';

export function useArtworkUrl(api: MediaApi, ref?: ArtworkRef): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
    setUrl(undefined);
    // A signed capability URL needs no client-side fetch, cache or Blob
    // lifecycle at all; the browser owns loading and caching directly.
    if (!ref || ref.url) return undefined;

    void fetchArtworkWithRetry(() => api.artwork(ref, controller?.signal), controller?.signal).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {
      if (active) setUrl(undefined);
    });

    return () => {
      active = false;
      controller?.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, ref?.id, ref?.url]);

  return ref?.url ?? url;
}
