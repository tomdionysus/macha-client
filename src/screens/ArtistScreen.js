import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { MediaCard } from '../components/MediaCard';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useAsync } from '../hooks/useAsync';
import { EditButton } from '../components/EditButton';
export function ArtistScreen({ api, artistId, onBack, onOpenAlbum, onAddToPlaylist, onPlayNext, onPlayLater, onShuffle, onEdit }) {
    const details = useAsync(() => api.details(artistId), [api, artistId]);
    const artist = details.value?.kind === 'artist' && 'albums' in details.value
        ? details.value
        : undefined;
    const backdrop = useArtworkUrl(api, artist?.artwork?.backdrop ?? artist?.artwork?.poster);
    if (details.loading)
        return _jsx(Loading, {});
    if (details.error)
        return _jsx(ErrorMessage, { error: details.error });
    if (!artist)
        return _jsx(ErrorMessage, { error: new Error('Catalogue item is not an artist.') });
    const albumActions = [
        { label: 'Add album to playlist', onSelect: onAddToPlaylist },
        { label: 'Shuffle', onSelect: onShuffle },
        { label: 'Play next', onSelect: onPlayNext },
        { label: 'Play later', onSelect: onPlayLater },
        { label: 'View album', onSelect: onOpenAlbum },
    ];
    return (_jsxs("section", { className: "detail music-detail", children: [backdrop && _jsx("div", { className: "detail-backdrop", style: { backgroundImage: `url(${JSON.stringify(backdrop)})` } }), _jsxs("div", { className: "detail-content series-content", children: [_jsx("button", { className: "back-button", "data-tv-focusable": "true", onClick: onBack, type: "button", children: "\u2190 Music" }), onEdit && _jsx(EditButton, { onClick: onEdit }), _jsx("p", { className: "eyebrow", children: "Artist" }), _jsx("h1", { children: artist.title }), artist.synopsis && _jsx("p", { className: "synopsis", children: artist.synopsis }), _jsx("h2", { children: "Albums" }), _jsx("div", { className: "media-grid", children: artist.albums.map((album) => (_jsx(MediaCard, { api: api, item: album, onOpen: onOpenAlbum, actions: albumActions }, album.id))) })] })] }));
}
