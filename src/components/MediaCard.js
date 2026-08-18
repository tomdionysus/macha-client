import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { routes } from '../routing';
function artworkClass(item) {
    return item.kind === 'album' || item.kind === 'artist' || item.kind === 'track' ? 'poster music-artwork' : 'poster';
}
function Poster({ api, item, progress }) {
    const image = useArtworkUrl(api, item.artwork?.poster ?? item.artwork?.thumbnail);
    return (_jsxs("div", { className: artworkClass(item), children: [image ? _jsx("img", { src: image, alt: "", loading: "lazy" }) : _jsx("div", { className: "poster-placeholder", children: item.title.slice(0, 1) }), progress !== undefined && progress > 0 && (_jsx("div", { className: "progress-track", children: _jsx("div", { className: "progress-value", style: { width: `${Math.min(100, progress * 100)}%` } }) }))] }));
}
function ContinueWatchingMenu({ item, onRemove }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const removeRef = useRef(null);
    useEffect(() => {
        if (!open)
            return undefined;
        removeRef.current?.focus();
        const onPointerDown = (event) => {
            if (!rootRef.current?.contains(event.target))
                setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape')
                return;
            event.preventDefault();
            setOpen(false);
            void Promise.resolve().then(() => triggerRef.current?.focus());
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);
    return (_jsxs("div", { ref: rootRef, className: "continue-card-menu", children: [_jsx("button", { ref: triggerRef, type: "button", className: "continue-card-menu-trigger", "data-tv-focusable": "true", "aria-label": `More options for ${item.title}`, "aria-haspopup": "menu", "aria-expanded": open, onClick: () => setOpen((value) => !value), children: _jsx("span", { "aria-hidden": "true", children: "\u22EF" }) }), open && (_jsx("div", { className: "continue-card-menu-popover", role: "menu", children: _jsx("button", { ref: removeRef, type: "button", role: "menuitem", "data-tv-focusable": "true", onClick: () => {
                        setOpen(false);
                        onRemove(item);
                    }, "aria-label": `Remove ${item.title} from Continue Watching`, children: "Remove" }) }))] }));
}
function ContinueWatchingEpisodeCard({ api, item, onOpen, onRemoveFromContinueWatching, progress, elementRef }) {
    const context = item.playbackContext;
    if (!context)
        throw new Error(`Continue Watching episode ${item.id} is missing playback hierarchy context.`);
    const seasonLabel = item.subtitle
        ? `${context.season.title} · ${item.subtitle}`
        : context.season.title;
    return (_jsxs("article", { className: "media-card media-card-episode continue-card", children: [_jsxs("button", { type: "button", ref: elementRef, className: "continue-card-open", "data-tv-focusable": "true", onClick: () => onOpen(item), "aria-label": `Resume ${item.title}`, children: [_jsx(Poster, { api: api, item: item, progress: progress }), _jsx("span", { className: "card-title continue-card-title", children: item.title })] }), _jsxs("div", { className: "continue-card-context", children: [_jsx(Link, { to: routes.show(context.series.id), "data-tv-focusable": "true", className: "continue-card-context-link", children: context.series.title }), _jsx(Link, { to: routes.season(context.series.id, context.season.id), "data-tv-focusable": "true", className: "continue-card-context-link", children: seasonLabel })] }), onRemoveFromContinueWatching && _jsx(ContinueWatchingMenu, { item: item, onRemove: onRemoveFromContinueWatching })] }));
}
function ContinueWatchingCard({ api, item, onOpen, onRemoveFromContinueWatching, progress, elementRef }) {
    return (_jsxs("article", { className: `media-card media-card-${item.kind} continue-card`, children: [_jsxs("button", { type: "button", ref: elementRef, className: "continue-card-open", "data-tv-focusable": "true", onClick: () => onOpen(item), "aria-label": `Resume ${item.title}`, children: [_jsx(Poster, { api: api, item: item, progress: progress }), _jsx("span", { className: "card-title", children: item.title }), (item.subtitle || item.year) && _jsx("span", { className: "card-subtitle", children: item.subtitle ?? item.year })] }), onRemoveFromContinueWatching && _jsx(ContinueWatchingMenu, { item: item, onRemove: onRemoveFromContinueWatching })] }));
}
export function MediaCard({ api, item, onOpen, onRemoveFromContinueWatching, progress, variant = 'default', elementRef }) {
    if (variant === 'continue-watching') {
        if (item.kind === 'episode') {
            return (_jsx(ContinueWatchingEpisodeCard, { api: api, item: item, onOpen: onOpen, onRemoveFromContinueWatching: onRemoveFromContinueWatching, progress: progress, variant: variant, elementRef: elementRef }));
        }
        return (_jsx(ContinueWatchingCard, { api: api, item: item, onOpen: onOpen, onRemoveFromContinueWatching: onRemoveFromContinueWatching, progress: progress, variant: variant, elementRef: elementRef }));
    }
    return (_jsxs("button", { ref: elementRef, className: `media-card media-card-${item.kind}`, "data-tv-focusable": "true", onClick: () => onOpen(item), children: [_jsx(Poster, { api: api, item: item, progress: progress }), _jsx("span", { className: "card-title", children: item.title }), (item.subtitle || item.year) && _jsx("span", { className: "card-subtitle", children: item.subtitle ?? item.year })] }));
}
