import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef } from 'react';
import { LazyArtwork } from '../components/LazyArtwork';
function PlaylistArtwork({ api, entry }) {
    return (_jsx("span", { className: "playlist-artwork", "aria-hidden": "true", children: _jsx(LazyArtwork, { api: api, artwork: entry.track.artwork?.poster ?? entry.track.artwork?.thumbnail, placeholder: _jsx("span", { children: entry.track.title.slice(0, 1) }) }) }));
}
export function MusicPlaylistScreen({ api, entries, onPlay, onShuffle, onRemove, onMove, onClear }) {
    const draggingEntry = useRef(undefined);
    const handleDragStart = (event, entryId) => {
        draggingEntry.current = entryId;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', entryId);
    };
    const handleDrop = (event, toIndex) => {
        event.preventDefault();
        const entryId = event.dataTransfer.getData('text/plain') || draggingEntry.current;
        draggingEntry.current = undefined;
        if (entryId)
            onMove(entryId, toIndex);
    };
    const handleReorderKey = (event, entryId, index) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
            return;
        event.preventDefault();
        onMove(entryId, index + (event.key === 'ArrowUp' ? -1 : 1));
    };
    return (_jsxs("section", { className: "music-playlist-page", children: [_jsx("h1", { children: "Music" }), _jsxs("div", { className: "playlist-heading-row", children: [_jsxs("div", { children: [_jsx("h2", { children: "Playlist" }), _jsxs("p", { children: [entries.length === 1 ? '1 track' : `${entries.length} tracks`, " \u00B7 stored on this client"] })] }), _jsxs("div", { className: "playlist-actions", children: [_jsx("button", { className: "primary-button", "data-tv-focusable": "true", type: "button", disabled: entries.length === 0, onClick: () => onPlay(0), children: "\u25B6 Play" }), _jsx("button", { className: "secondary-button", "data-tv-focusable": "true", type: "button", disabled: entries.length === 0, onClick: onShuffle, children: "Shuffle" }), _jsx("button", { className: "secondary-button", "data-tv-focusable": "true", type: "button", disabled: entries.length === 0, onClick: onClear, children: "Clear" })] })] }), entries.length === 0 ? (_jsx("p", { className: "playlist-empty", children: "The local playlist is empty. Add tracks or albums from the Music browser." })) : (_jsx("div", { className: "playlist-track-list", "aria-label": "Playlist tracks", children: entries.map((entry, index) => (_jsxs("div", { className: "playlist-track-row", onDragOver: (event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                    }, onDrop: (event) => handleDrop(event, index), children: [_jsx("button", { className: "playlist-drag-handle", type: "button", draggable: true, "data-tv-focusable": "true", "aria-label": `Reorder ${entry.track.title}. Use drag or arrow keys.`, title: "Drag to reorder; arrow keys also move the track", onDragStart: (event) => handleDragStart(event, entry.entryId), onDragEnd: () => { draggingEntry.current = undefined; }, onKeyDown: (event) => handleReorderKey(event, entry.entryId, index), children: _jsx("span", { "aria-hidden": "true", children: "\u2630" }) }), _jsx("span", { className: "playlist-track-number", children: index + 1 }), _jsx(PlaylistArtwork, { api: api, entry: entry }), _jsxs("button", { className: "playlist-track-copy playlist-track-play", type: "button", "data-tv-focusable": "true", onClick: () => onPlay(index), "aria-label": `Play ${entry.track.title} now`, children: [_jsx("strong", { children: entry.track.title }), entry.track.subtitle && _jsx("small", { children: entry.track.subtitle })] }), _jsx("button", { className: "playlist-remove", type: "button", "data-tv-focusable": "true", "aria-label": `Remove ${entry.track.title} from playlist`, title: "Remove from playlist", onClick: () => onRemove(entry.entryId), children: "\u00D7" })] }, entry.entryId))) }))] }));
}
