import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { PlayIcon, RestartIcon } from '../components/PlaybackIcons';
import { useAsync } from '../hooks/useAsync';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
function canPlayDirectly(details) {
    return details.kind === 'movie' || details.kind === 'episode' || details.kind === 'track';
}
function canResume(media, progress) {
    return (media.kind === 'movie' || media.kind === 'episode')
        && Boolean(progress && progress.positionMs > 0 && progress.durationMs > 0);
}
export function DetailScreen({ api, itemId, onBack, onPlay, onPlayFromStart, progress }) {
    const details = useAsync(() => api.details(itemId), [api, itemId]);
    const backdrop = useArtworkUrl(api, details.value?.artwork?.backdrop ?? details.value?.artwork?.poster ?? details.value?.artwork?.thumbnail);
    const poster = useArtworkUrl(api, details.value?.kind === 'movie' ? details.value.artwork?.poster : undefined);
    if (details.loading)
        return _jsx(Loading, {});
    if (details.error)
        return _jsx(ErrorMessage, { error: details.error });
    if (!details.value)
        return null;
    const media = details.value;
    const playable = canPlayDirectly(media) && media.mediaIds.length > 0;
    const resumable = playable && canResume(media, progress);
    const copy = (_jsxs("div", { className: "detail-copy", children: [_jsxs("p", { className: "eyebrow", children: [media.kind, media.year ? ` · ${media.year}` : ''] }), _jsx("h1", { children: media.title }), media.subtitle && _jsx("p", { className: "subtitle", children: media.subtitle }), media.synopsis && _jsx("p", { className: "synopsis", children: media.synopsis }), playable && (_jsxs("div", { className: "play-actions detail-play-controls", "aria-label": "Playback controls", children: [_jsx("button", { className: "media-control-button", "data-tv-focusable": "true", onClick: () => onPlay(media), type: "button", "aria-label": resumable ? 'Resume playback' : 'Play', title: resumable ? 'Resume playback' : 'Play', children: _jsx(PlayIcon, {}) }), resumable && (_jsx("button", { className: "media-control-button", "data-tv-focusable": "true", onClick: () => onPlayFromStart(media), type: "button", "aria-label": "Play from start", title: "Play from start", children: _jsx(RestartIcon, {}) }))] }))] }));
    return (_jsxs("section", { className: `detail ${media.kind === 'movie' ? 'movie-detail' : ''}`, children: [backdrop && _jsx("div", { className: "detail-backdrop", style: { backgroundImage: `url(${JSON.stringify(backdrop)})` } }), _jsxs("div", { className: "detail-content", children: [_jsx("button", { className: "back-button", "data-tv-focusable": "true", onClick: onBack, type: "button", children: "\u2190 Back" }), media.kind === 'movie' ? (_jsxs("div", { className: `movie-detail-layout ${poster ? 'has-poster' : ''}`, children: [_jsx("div", { className: "movie-detail-poster", "aria-hidden": "true", children: poster ? _jsx("img", { src: poster, alt: "" }) : _jsx("div", { className: "movie-detail-poster-placeholder", children: media.title.slice(0, 1) }) }), copy] })) : copy] })] }));
}
