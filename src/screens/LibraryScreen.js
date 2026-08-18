import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from 'react';
import { useAsync } from '../hooks/useAsync';
import { useAlphabetIndex } from '../hooks/useAlphabetIndex';
import { ErrorMessage, Loading } from '../components/Status';
import { MediaCard } from '../components/MediaCard';
import { AlphabetIndex } from '../components/AlphabetIndex';
import { sortMediaByIndexedTitle } from '../titleIndex';
export function LibraryScreen({ api, kind, onOpen }) {
    const result = useAsync(() => kind === 'movies' ? api.movies() : api.shows(), [api, kind]);
    const items = useMemo(() => sortMediaByIndexedTitle(result.value ?? []), [result.value]);
    const alphabet = useAlphabetIndex(items);
    if (result.loading)
        return _jsx(Loading, {});
    if (result.error)
        return _jsx(ErrorMessage, { error: result.error });
    return (_jsxs("section", { className: "catalogue-indexed", children: [_jsx("h1", { children: kind === 'movies' ? 'Movies' : 'TV Shows' }), _jsx("div", { className: "media-grid", children: items.map((item) => (_jsx(MediaCard, { api: api, item: item, onOpen: onOpen, elementRef: (element) => alphabet.registerItem(item.id, element) }, item.id))) }), _jsx(AlphabetIndex, { availableKeys: alphabet.availableKeys, onSelect: alphabet.jumpTo })] }));
}
