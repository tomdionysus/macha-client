import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { MediaCard } from '../components/MediaCard';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useAsync } from '../hooks/useAsync';
import { EditButton } from '../components/EditButton';
export function SeriesScreen({ api, seriesId, onBack, onOpenSeason, onEdit }) {
    const details = useAsync(() => api.details(seriesId), [api, seriesId]);
    const show = details.value?.kind === 'show' && 'seasons' in details.value ? details.value : undefined;
    const backdrop = useArtworkUrl(api, show?.artwork?.backdrop ?? show?.artwork?.poster);
    if (details.loading)
        return _jsx(Loading, {});
    if (details.error)
        return _jsx(ErrorMessage, { error: details.error });
    if (!show)
        return _jsx(ErrorMessage, { error: new Error('Catalogue item is not a series.') });
    return (_jsxs("section", { className: "detail series-detail", children: [backdrop && _jsx("div", { className: "detail-backdrop", style: { backgroundImage: `url(${JSON.stringify(backdrop)})` } }), _jsxs("div", { className: "detail-content series-content", children: [_jsx("button", { className: "back-button", "data-tv-focusable": "true", onClick: onBack, type: "button", children: "\u2190 Back" }), onEdit && _jsx(EditButton, { onClick: onEdit }), _jsxs("p", { className: "eyebrow", children: ["TV Series", show.year ? ` · ${show.year}` : ''] }), _jsx("h1", { children: show.title }), show.synopsis && _jsx("p", { className: "synopsis", children: show.synopsis }), _jsxs("section", { className: "media-section season-section", children: [_jsx("h2", { children: "Seasons" }), _jsx("div", { className: "media-row season-row", children: show.seasons.map((season) => (_jsx(MediaCard, { api: api, item: season, onOpen: () => onOpenSeason(season) }, season.id))) })] })] })] }));
}
