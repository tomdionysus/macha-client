import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { routes } from '../routing';
import { OverflowMenu } from './OverflowMenu';
function artworkClass(item) {
    return item.kind === 'album' || item.kind === 'artist' || item.kind === 'track' ? 'poster music-artwork' : 'poster';
}
function Poster({ api, item, progress }) {
    const image = useArtworkUrl(api, item.artwork?.poster ?? item.artwork?.thumbnail);
    return (_jsxs("div", { className: artworkClass(item), children: [image ? _jsx("img", { src: image, alt: "", loading: "lazy" }) : _jsx("div", { className: "poster-placeholder", children: item.title.slice(0, 1) }), progress !== undefined && progress > 0 && (_jsx("div", { className: "progress-track", children: _jsx("div", { className: "progress-value", style: { width: `${Math.min(100, progress * 100)}%` } }) }))] }));
}
function actionItems(item, actions) {
    return actions.map((action) => ({
        label: action.label,
        disabled: action.disabled,
        destructive: action.destructive,
        onSelect: () => action.onSelect(item),
    }));
}
function ContinueWatchingEpisodeCard({ api, item, onOpen, onRemoveFromContinueWatching, progress, elementRef }) {
    const context = item.playbackContext;
    if (!context)
        throw new Error(`Continue Watching episode ${item.id} is missing playback hierarchy context.`);
    const seasonLabel = item.subtitle
        ? `${context.season.title} · ${item.subtitle}`
        : context.season.title;
    const actions = onRemoveFromContinueWatching
        ? [{ label: 'Remove', onSelect: onRemoveFromContinueWatching, destructive: true }]
        : [];
    return (_jsxs("article", { className: "media-card media-card-episode continue-card", children: [_jsxs("button", { type: "button", ref: elementRef, className: "continue-card-open", "data-tv-focusable": "true", onClick: () => onOpen(item), "aria-label": `Resume ${item.title}`, children: [_jsx(Poster, { api: api, item: item, progress: progress }), _jsx("span", { className: "card-title continue-card-title", children: item.title })] }), _jsxs("div", { className: "continue-card-context", children: [_jsx(Link, { to: routes.show(context.series.id), "data-tv-focusable": "true", className: "continue-card-context-link", children: context.series.title }), _jsx(Link, { to: routes.season(context.series.id, context.season.id), "data-tv-focusable": "true", className: "continue-card-context-link", children: seasonLabel })] }), actions.length > 0 && (_jsx(OverflowMenu, { className: "card-overflow-menu", label: `More options for ${item.title}`, actions: actionItems(item, actions) }))] }));
}
function ContinueWatchingCard({ api, item, onOpen, onRemoveFromContinueWatching, progress, elementRef }) {
    const actions = onRemoveFromContinueWatching
        ? [{ label: 'Remove', onSelect: onRemoveFromContinueWatching, destructive: true }]
        : [];
    return (_jsxs("article", { className: `media-card media-card-${item.kind} continue-card`, children: [_jsxs("button", { type: "button", ref: elementRef, className: "continue-card-open", "data-tv-focusable": "true", onClick: () => onOpen(item), "aria-label": `Resume ${item.title}`, children: [_jsx(Poster, { api: api, item: item, progress: progress }), _jsx("span", { className: "card-title", children: item.title }), (item.subtitle || item.year) && _jsx("span", { className: "card-subtitle", children: item.subtitle ?? item.year })] }), actions.length > 0 && (_jsx(OverflowMenu, { className: "card-overflow-menu", label: `More options for ${item.title}`, actions: actionItems(item, actions) }))] }));
}
function ActionableMediaCard({ api, item, onOpen, actions = [], progress, elementRef }) {
    return (_jsxs("article", { className: `media-card media-card-${item.kind} continue-card media-card-actionable`, children: [_jsxs("button", { type: "button", ref: elementRef, className: "continue-card-open", "data-tv-focusable": "true", onClick: () => onOpen(item), "aria-label": `Play ${item.title} now`, children: [_jsx(Poster, { api: api, item: item, progress: progress }), _jsx("span", { className: "card-title", children: item.title }), (item.subtitle || item.year) && _jsx("span", { className: "card-subtitle", children: item.subtitle ?? item.year })] }), _jsx(OverflowMenu, { className: "card-overflow-menu", label: `More options for ${item.title}`, actions: actionItems(item, actions) })] }));
}
export function MediaCard({ api, item, onOpen, onRemoveFromContinueWatching, actions, progress, variant = 'default', elementRef }) {
    if (variant === 'continue-watching') {
        if (item.kind === 'episode') {
            return (_jsx(ContinueWatchingEpisodeCard, { api: api, item: item, onOpen: onOpen, onRemoveFromContinueWatching: onRemoveFromContinueWatching, progress: progress, variant: variant, elementRef: elementRef }));
        }
        return (_jsx(ContinueWatchingCard, { api: api, item: item, onOpen: onOpen, onRemoveFromContinueWatching: onRemoveFromContinueWatching, progress: progress, variant: variant, elementRef: elementRef }));
    }
    if (actions?.length) {
        return (_jsx(ActionableMediaCard, { api: api, item: item, onOpen: onOpen, actions: actions, progress: progress, elementRef: elementRef }));
    }
    return (_jsxs("button", { ref: elementRef, className: `media-card media-card-${item.kind}`, "data-tv-focusable": "true", onClick: () => onOpen(item), children: [_jsx(Poster, { api: api, item: item, progress: progress }), _jsx("span", { className: "card-title", children: item.title }), (item.subtitle || item.year) && _jsx("span", { className: "card-subtitle", children: item.subtitle ?? item.year })] }));
}
