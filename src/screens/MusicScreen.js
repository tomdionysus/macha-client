import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from 'react';
import { AlphabetIndex } from '../components/AlphabetIndex';
import { ErrorMessage, Loading } from '../components/Status';
import { MediaRow } from '../components/MediaRow';
import { useAlphabetIndex } from '../hooks/useAlphabetIndex';
import { useAsync } from '../hooks/useAsync';
import { sortMediaByIndexedTitle } from '../titleIndex';
export function MusicScreen({ api, onOpen }) {
    const music = useAsync(async () => {
        const [artists, albums] = await Promise.all([api.artists(), api.albums()]);
        return { artists, albums };
    }, [api]);
    const artists = useMemo(() => sortMediaByIndexedTitle(music.value?.artists ?? []), [music.value?.artists]);
    const albums = useMemo(() => sortMediaByIndexedTitle(music.value?.albums ?? []), [music.value?.albums]);
    const indexedItems = useMemo(() => [...artists, ...albums], [artists, albums]);
    const alphabet = useAlphabetIndex(indexedItems);
    if (music.loading)
        return _jsx(Loading, {});
    if (music.error)
        return _jsx(ErrorMessage, { error: music.error });
    if (!music.value)
        return null;
    return (_jsxs("section", { className: "catalogue-indexed", children: [_jsx("h1", { children: "Music" }), _jsx(MediaRow, { api: api, title: "Artists", items: artists, onOpen: onOpen, itemRef: alphabet.registerItem }), _jsx(MediaRow, { api: api, title: "Albums", items: albums, onOpen: onOpen, itemRef: alphabet.registerItem }), _jsx(AlphabetIndex, { availableKeys: alphabet.availableKeys, onSelect: alphabet.jumpTo })] }));
}
