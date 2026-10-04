import { useEffect, useMemo, useState } from 'react';
import { currentAvailability, type CatalogueApi, type ItemAvailability, type MediaSummary } from '@machafoundation/core';

/**
 * Stored titles with availability read from the catalogue, once per change of titles: no
 * store keeps it. A title with no answer carries none: no marker, and playable.
 */
export function useCurrentAvailability<T extends Pick<MediaSummary, 'id'>>(items: readonly T[], catalogue: Pick<CatalogueApi, 'get'>): Array<T & ItemAvailability> {
  const [found, setFound] = useState<Map<string, ItemAvailability>>(new Map());
  const key = items.map((item) => item.id).join('\n');
  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    void currentAvailability(key.split('\n'), catalogue, controller.signal)
      .then((next) => { if (!controller.signal.aborted) setFound(next); }, () => undefined);
    return () => controller.abort();
  }, [key, catalogue]);
  return useMemo(() => items.map((item) => ({ ...item, ...found.get(item.id) })), [items, found]);
}
