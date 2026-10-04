import { useEffect, useState } from 'react';
import type { MediaApi } from '@machafoundation/core';
import type { ArtworkRef } from '@machafoundation/core';
import { fetchArtworkWithRetry } from './artworkRetry';

export function useArtworkUrl(api: MediaApi, ref?: ArtworkRef): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
    setUrl(undefined);
    // A signed capability URL needs no fetch here; the browser loads and caches it.
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
