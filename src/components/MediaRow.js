import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { MediaCard } from './MediaCard';
export function MediaRow({ api, title, items, onOpen, onRemoveFromContinueWatching, progress, variant = 'default', itemRef }) {
    if (items.length === 0)
        return null;
    return (_jsxs("section", { className: "media-section", children: [_jsx("h2", { children: title }), _jsx("div", { className: "media-row", children: items.map((item) => {
                    const entry = progress?.get(item.id);
                    const ratio = entry && entry.durationMs > 0 ? entry.positionMs / entry.durationMs : undefined;
                    return (_jsx(MediaCard, { api: api, item: item, onOpen: onOpen, onRemoveFromContinueWatching: onRemoveFromContinueWatching, progress: ratio, variant: variant, elementRef: itemRef ? (element) => itemRef(item.id, element) : undefined }, item.id));
                }) })] }));
}
