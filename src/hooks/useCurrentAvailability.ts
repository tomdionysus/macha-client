import { useEffect, useMemo, useState } from 'react';
import { currentAvailability, type CatalogueApi, type ItemAvailability, type MediaSummary } from '@machafoundation/core';

/**
 * Stored titles with their availability read now. No store keeps it, since
 * a node coming back must not leave a title locked, so a row built from a
 * store asks the catalogue, once per change of titles. Until the answer
 * comes, and for a title the catalogue did not answer for, a title carries
 * no availability: no marker, and playable.
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
