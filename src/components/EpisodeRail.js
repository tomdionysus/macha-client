import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef } from 'react';
import { LazyArtwork } from './LazyArtwork';
import { PlayIcon, RestartIcon } from './PlaybackIcons';
function displayDate(value) {
    if (!value)
        return 'Air date unavailable';
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime()))
        return value;
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
}
function resumable(progress) {
    return Boolean(progress && progress.positionMs > 0 && progress.durationMs > 0);
}
function EpisodeCard({ api, episode, progress, playbackEpisode, queue, queueIndex, onPlayEpisode }) {
    const hasProgress = resumable(progress);
    return (_jsxs("article", { className: `episode-card${hasProgress ? ' has-progress' : ''}`, children: [_jsxs("div", { className: "episode-still-shell", children: [_jsx("button", { className: "episode-still-link", "data-tv-focusable": "true", "aria-label": `${hasProgress ? 'Resume' : 'Play'} ${episode.title}`, onClick: () => onPlayEpisode(playbackEpisode, queue, queueIndex, false), type: "button", children: _jsxs("div", { className: "episode-still", children: [_jsx(LazyArtwork, { api: api, artwork: episode.artwork?.thumbnail ?? episode.artwork?.backdrop, draggable: false, placeholder: _jsx("div", { className: "episode-still-placeholder", children: episode.episodeNumber }) }), progress && progress.durationMs > 0 && (_jsx("div", { className: "episode-progress-track", "aria-hidden": "true", children: _jsx("div", { className: "episode-progress-value", style: { width: `${Math.min(100, progress.positionMs / progress.durationMs * 100)}%` } }) }))] }) }), _jsxs("div", { className: "episode-play-actions", "aria-hidden": !hasProgress, children: [_jsx("span", { className: "episode-play-action episode-play-resume", "aria-hidden": "true", children: _jsx(PlayIcon, {}) }), hasProgress && (_jsx("button", { className: "episode-play-action episode-play-restart", "data-tv-focusable": "true", "aria-label": `Play ${episode.title} from start`, onClick: () => onPlayEpisode(playbackEpisode, queue, queueIndex, true), type: "button", children: _jsx(RestartIcon, {}) }))] })] }), _jsxs("div", { className: "episode-copy", children: [_jsxs("div", { className: "episode-heading", children: [_jsxs("strong", { children: [episode.episodeNumber, ". ", episode.title] }), _jsx("span", { children: displayDate(episode.releaseDate) })] }), _jsx("p", { children: episode.synopsis || 'No description available.' })] })] }));
}
export function EpisodeRail({ api, episodes, progress, series, season, onPlayEpisode }) {
    const playbackQueue = episodes.map((episode) => ({
        ...episode,
        playbackContext: {
            series: { id: series.id, title: series.title },
            season: { id: season.id, title: season.title, seasonNumber: season.seasonNumber },
        },
    }));
    const railRef = useRef(null);
    const drag = useRef(undefined);
    const suppressClick = useRef(false);
    const onPointerDown = (event) => {
        const rail = railRef.current;
        if (!rail || event.pointerType === 'mouse' && event.button !== 0)
            return;
        drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startScrollLeft: rail.scrollLeft,
            moved: false,
            captured: false,
        };
    };
    const onPointerMove = (event) => {
        const rail = railRef.current;
        const state = drag.current;
        if (!rail || !state || state.pointerId !== event.pointerId)
            return;
        const delta = event.clientX - state.startX;
        if (Math.abs(delta) > 6)
            state.moved = true;
        if (!state.moved)
            return;
        if (!state.captured) {
            rail.setPointerCapture(event.pointerId);
            state.captured = true;
        }
        event.preventDefault();
        rail.scrollLeft = state.startScrollLeft - delta;
    };
    const finishDrag = (event) => {
        const rail = railRef.current;
        const state = drag.current;
        if (!rail || !state || state.pointerId !== event.pointerId)
            return;
        suppressClick.current = state.moved;
        drag.current = undefined;
        if (state.captured && rail.hasPointerCapture(event.pointerId))
            rail.releasePointerCapture(event.pointerId);
        if (suppressClick.current) {
            window.setTimeout(() => { suppressClick.current = false; }, 0);
        }
    };
    const onClickCapture = (event) => {
        if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
        }
    };
    const onWheel = (event) => {
        const rail = railRef.current;
        if (!rail || Math.abs(event.deltaY) <= Math.abs(event.deltaX))
            return;
        if (rail.scrollWidth <= rail.clientWidth)
            return;
        event.preventDefault();
        rail.scrollLeft += event.deltaY;
    };
    return (_jsx("div", { ref: railRef, className: "episode-rail", role: "list", "aria-label": "Episodes", onPointerDown: onPointerDown, onPointerMove: onPointerMove, onPointerUp: finishDrag, onPointerCancel: finishDrag, onClickCapture: onClickCapture, onWheel: onWheel, children: episodes.map((episode, index) => (_jsx("div", { className: "episode-rail-item", role: "listitem", children: _jsx(EpisodeCard, { api: api, episode: episode, progress: progress.get(episode.id), playbackEpisode: playbackQueue[index], queue: playbackQueue, queueIndex: index, onPlayEpisode: onPlayEpisode }) }, episode.id))) }));
}
