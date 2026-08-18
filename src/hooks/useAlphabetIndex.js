import { useCallback, useMemo, useRef } from 'react';
import { alphabetIndexKey, availableAlphabetKeys } from '../titleIndex';
export function useAlphabetIndex(items) {
    const targets = useRef(new Map());
    const firstItemByKey = useMemo(() => {
        const result = new Map();
        for (const item of items) {
            const key = alphabetIndexKey(item.title);
            if (!result.has(key))
                result.set(key, item.id);
        }
        return result;
    }, [items]);
    const availableKeys = useMemo(() => availableAlphabetKeys(items), [items]);
    const registerItem = useCallback((itemId, element) => {
        if (element)
            targets.current.set(itemId, element);
        else
            targets.current.delete(itemId);
    }, []);
    const jumpTo = useCallback((key) => {
        const itemId = firstItemByKey.get(key);
        if (!itemId)
            return;
        targets.current.get(itemId)?.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
    }, [firstItemByKey]);
    return { availableKeys, jumpTo, registerItem };
}
