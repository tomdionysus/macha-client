import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { OverflowMenu } from '../components/OverflowMenu';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useAsync } from '../hooks/useAsync';
import { EditButton } from '../components/EditButton';
export function AlbumScreen({ api, albumId, onBack, onPlayTrack, onPlayAll, onOpenTrack, onAddToPlaylist, onPlayNext, onPlayLater, onShuffle, onEdit }) {
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
    return (_jsxs("section", { className: "album-page", children: [_jsx("button", { className: "back-button", "data-tv-focusable": "true", onClick: onBack, type: "button", children: "\u2190 Music" }), onEdit && _jsx(EditButton, { onClick: onEdit }), _jsxs("div", { className: "album-header", children: [_jsx("div", { className: "album-cover", children: cover ? _jsx("img", { src: cover, alt: "" }) : _jsx("div", { className: "poster-placeholder", children: album.title.slice(0, 1) }) }), _jsxs("div", { children: [_jsxs("p", { className: "eyebrow", children: ["Album", album.year ? ` · ${album.year}` : ''] }), _jsx("h1", { children: album.title }), album.synopsis && _jsx("p", { className: "synopsis", children: album.synopsis }), _jsxs("div", { className: "play-actions album-actions", children: [_jsx("button", { className: "primary-button", type: "button", "data-tv-focusable": "true", disabled: album.tracks.length === 0, onClick: () => onPlayAll(album), children: "\u25B6 Play all" }), _jsx("button", { className: "secondary-button", type: "button", "data-tv-focusable": "true", disabled: album.tracks.length === 0, onClick: () => onShuffle(album), children: "Shuffle" }), _jsx("button", { className: "secondary-button", type: "button", "data-tv-focusable": "true", disabled: album.tracks.length === 0, onClick: () => onAddToPlaylist(album), children: "Add to playlist" }), _jsx(OverflowMenu, { className: "inline-overflow-menu", label: `More options for ${album.title}`, actions: [
                                            { label: 'Play next', onSelect: () => onPlayNext(album), disabled: album.tracks.length === 0 },
                                            { label: 'Play later', onSelect: () => onPlayLater(album), disabled: album.tracks.length === 0 },
                                        ] })] })] })] }), _jsx("div", { className: "track-list", "aria-label": "Tracks", children: album.tracks.map((track, index) => {
                    const actions = [
                        { label: 'Add track to playlist', onSelect: () => onAddToPlaylist(track) },
                        { label: 'Play next', onSelect: () => onPlayNext(track) },
                        { label: 'Play later', onSelect: () => onPlayLater(track) },
                        { label: 'View track', onSelect: () => onOpenTrack(track) },
                    ];
                    return (_jsxs("div", { className: "track-row", children: [_jsxs("button", { className: "track-row-open", "data-tv-focusable": "true", type: "button", onClick: () => onPlayTrack(track, album.tracks, index), children: [_jsx("span", { className: "track-number", children: track.trackNumber ?? '–' }), _jsx("span", { className: "track-title", children: track.title }), _jsx("span", { className: "track-action", children: "\u25B6" })] }), _jsx(OverflowMenu, { className: "track-overflow-menu", label: `More options for ${track.title}`, actions: actions })] }, track.id));
                }) })] }));
}
