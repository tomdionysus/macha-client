import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from 'react';
import { AlphabetIndex } from '../components/AlphabetIndex';
import { MediaCard } from '../components/MediaCard';
import { MusicNav } from '../components/MusicNav';
import { ErrorMessage, Loading } from '../components/Status';
import { useAlphabetIndex } from '../hooks/useAlphabetIndex';
import { useAsync } from '../hooks/useAsync';
import { sortMediaByIndexedTitle } from '../titleIndex';
function titleFor(section) {
    if (section === 'artists')
        return 'Artists';
    if (section === 'albums')
        return 'Albums';
    return 'Tracks';
}
export function MusicScreen({ api, section, onOpen, onPlayNow, onAddToPlaylist, onPlayNext, onPlayLater, onShuffle }) {
    const result = useAsync(() => {
        if (section === 'artists')
            return api.artists();
        if (section === 'albums')
            return api.albums();
        return api.tracks();
    }, [api, section]);
    const items = useMemo(() => sortMediaByIndexedTitle(result.value ?? []), [result.value]);
    const alphabet = useAlphabetIndex(items);
    if (result.loading)
        return _jsx(Loading, {});
    if (result.error)
        return _jsx(ErrorMessage, { error: result.error });
    const actions = section === 'artists' ? [] : [
        { label: section === 'albums' ? 'Add album to playlist' : 'Add track to playlist', onSelect: onAddToPlaylist },
        ...(section === 'albums' ? [{ label: 'Shuffle', onSelect: onShuffle }] : []),
        { label: 'Play next', onSelect: onPlayNext },
        { label: 'Play later', onSelect: onPlayLater },
        { label: section === 'albums' ? 'View album' : 'View track', onSelect: onOpen },
    ];
    return (_jsxs("section", { className: "catalogue-indexed music-browser", children: [_jsx("h1", { children: "Music" }), _jsx(MusicNav, {}), _jsx("h2", { className: "music-browser-heading", children: titleFor(section) }), _jsx("div", { className: "media-grid", children: items.map((item) => (_jsx(MediaCard, { api: api, item: item, onOpen: section === 'tracks' ? onPlayNow : onOpen, actions: actions, elementRef: (element) => alphabet.registerItem(item.id, element) }, item.id))) }), _jsx(AlphabetIndex, { availableKeys: alphabet.availableKeys, onSelect: alphabet.jumpTo })] }));
}
