import { useCallback, useMemo, useRef } from 'react';
import type { MediaSummary } from '@macha/core';
import { alphabetIndexKey, availableAlphabetKeys, type AlphabetIndexKey } from '@macha/core';

export function useAlphabetIndex(items: MediaSummary[]) {
  const targets = useRef(new Map<string, HTMLElement>());

  const firstItemByKey = useMemo(() => {
    const result = new Map<AlphabetIndexKey, string>();
    for (const item of items) {
      const key = alphabetIndexKey(item.title);
      if (!result.has(key)) result.set(key, item.id);
    }
    return result;
  }, [items]);

  const availableKeys = useMemo(() => availableAlphabetKeys(items), [items]);

  const registerItem = useCallback((itemId: string, element: HTMLElement | null) => {
    if (element) targets.current.set(itemId, element);
    else targets.current.delete(itemId);
  }, []);

  const jumpTo = useCallback((key: AlphabetIndexKey) => {
    const itemId = firstItemByKey.get(key);
    if (!itemId) return;
    targets.current.get(itemId)?.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
  }, [firstItemByKey]);

  return { availableKeys, jumpTo, registerItem };
}
