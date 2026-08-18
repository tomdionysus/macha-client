import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useAsync } from '../hooks/useAsync';
export function AlbumScreen({ api, albumId, onBack, onPlayTrack }) {
    const details = useAsync(() => api.details(albumId), [api, albumId]);
    const album = details.value?.kind === 'album' && 'tracks' in details.value
        ? details.value
        : undefined;
    const cover = useArtworkUrl(api, album?.artwork?.poster ?? album?.artwork?.thumbnail);
    if (details.loading)
        return _jsx(Loading, {});
    if (details.error)
        return _jsx(ErrorMessage, { error: details.error });
    if (!album)
        return _jsx(ErrorMessage, { error: new Error('Catalogue item is not an album.') });
    return (_jsxs("section", { className: "album-page", children: [_jsx("button", { className: "back-button", "data-tv-focusable": "true", onClick: onBack, type: "button", children: "\u2190 Music" }), _jsxs("div", { className: "album-header", children: [_jsx("div", { className: "album-cover", children: cover ? _jsx("img", { src: cover, alt: "" }) : _jsx("div", { className: "poster-placeholder", children: album.title.slice(0, 1) }) }), _jsxs("div", { children: [_jsxs("p", { className: "eyebrow", children: ["Album", album.year ? ` · ${album.year}` : ''] }), _jsx("h1", { children: album.title }), album.synopsis && _jsx("p", { className: "synopsis", children: album.synopsis })] })] }), _jsx("div", { className: "track-list", "aria-label": "Tracks", children: album.tracks.map((track, index) => (_jsxs("button", { className: "track-row", "data-tv-focusable": "true", type: "button", onClick: () => onPlayTrack(track, album.tracks, index), children: [_jsx("span", { className: "track-number", children: track.trackNumber ?? '–' }), _jsx("span", { className: "track-title", children: track.title }), _jsx("span", { className: "track-action", children: "\u25B6" })] }, track.id))) })] }));
}
