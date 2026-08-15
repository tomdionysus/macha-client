import { useEffect, useState } from 'react';
import type { MediaApi } from '../api/MediaApi';
import type { ArtworkRef } from '../types';

export function useArtworkUrl(api: MediaApi, ref?: ArtworkRef): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setUrl(undefined);
    if (!ref) return;

    void api.artwork(ref).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {
      if (active) setUrl(undefined);
    });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, ref?.id]);

  return url;
}
