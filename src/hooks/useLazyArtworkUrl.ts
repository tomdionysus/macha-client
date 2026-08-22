import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaApi } from '../api/MediaApi';
import type { ArtworkRef } from '../types';
import { ArtworkRequestScheduler, type ArtworkRequestHandle } from './artworkScheduler';
import { observeArtworkVisibility } from './artworkVisibility';
import { fetchArtworkWithRetry } from './artworkRetry';

const schedulers = new WeakMap<MediaApi, ArtworkRequestScheduler<Blob>>();

function schedulerFor(api: MediaApi): ArtworkRequestScheduler<Blob> {
  let scheduler = schedulers.get(api);
  if (!scheduler) {
    scheduler = new ArtworkRequestScheduler<Blob>(6);
    schedulers.set(api, scheduler);
  }
  return scheduler;
}

interface ArtworkVisibility {
  ref: (element: HTMLElement | null) => void;
  nearby: boolean;
  visible: boolean;
}

export function useArtworkVisibility(eager = false): ArtworkVisibility {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [nearby, setNearby] = useState(eager);
  const [visible, setVisible] = useState(eager);
  const ref = useCallback((next: HTMLElement | null) => setElement(next), []);

  useEffect(() => {
    if (eager) {
      setNearby(true);
      setVisible(true);
      return;
    }
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNearby(true);
      setVisible(true);
      return;
    }

    return observeArtworkVisibility(element, setNearby, setVisible);
  }, [eager, element]);

  return { ref, nearby, visible };
}

export function useLazyArtworkUrl(
  api: MediaApi,
  ref: ArtworkRef | undefined,
  enabled: boolean,
  visible: boolean,
): string | undefined {
  const [url, setUrl] = useState<string>();
  const objectUrlRef = useRef<string | undefined>(undefined);
  const handleRef = useRef<ArtworkRequestHandle<Blob> | undefined>(undefined);

  useEffect(() => {
    if (visible) handleRef.current?.promote();
  }, [visible]);

  useEffect(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = undefined;
    }
    setUrl(undefined);
    if (!enabled || !ref) return;

    let active = true;
    const handle = schedulerFor(api).request(
      ref.id,
      () => fetchArtworkWithRetry(() => api.artwork(ref)),
      visible ? 'visible' : 'nearby',
    );
    handleRef.current = handle;

    void handle.promise.then((blob) => {
      if (!active) return;
      const objectUrl = URL.createObjectURL(blob);
      objectUrlRef.current = objectUrl;
      setUrl(objectUrl);
    }).catch(() => {
      if (active) setUrl(undefined);
    });

    return () => {
      active = false;
      handle.cancel();
      if (handleRef.current === handle) handleRef.current = undefined;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = undefined;
      }
    };
  }, [api, enabled, ref?.id]);

  return url;
}
