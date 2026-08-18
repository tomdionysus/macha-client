import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { EpisodeRail } from '../components/EpisodeRail';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useAsync } from '../hooks/useAsync';
export function SeasonScreen({ api, seriesId, seasonId, onBack, progress, onPlayEpisode }) {
    const result = useAsync(async () => {
        const [seriesResult, seasonResult] = await Promise.all([api.details(seriesId), api.details(seasonId)]);
        if (seriesResult.kind !== 'show' || !('seasons' in seriesResult))
            throw new Error('Parent catalogue item is not a series.');
        if (seasonResult.kind !== 'season' || !('episodes' in seasonResult))
            throw new Error('Catalogue item is not a season.');
        const series = seriesResult;
        const season = seasonResult;
        if (season.parentId && season.parentId !== series.id)
            throw new Error('Season does not belong to this series.');
        return { series, season };
    }, [api, seriesId, seasonId]);
    const season = result.value?.season;
    const series = result.value?.series;
    const artwork = season?.artwork?.backdrop
        ?? season?.artwork?.poster
        ?? series?.artwork?.backdrop
        ?? series?.artwork?.poster;
    const backdrop = useArtworkUrl(api, artwork);
    if (result.loading)
        return _jsx(Loading, {});
    if (result.error)
        return _jsx(ErrorMessage, { error: result.error });
    if (!season || !series)
        return null;
    return (_jsxs("section", { className: "detail season-detail", children: [backdrop && _jsx("div", { className: "detail-backdrop season-backdrop", style: { backgroundImage: `url(${JSON.stringify(backdrop)})` } }), _jsxs("div", { className: "detail-content season-content", children: [_jsx("button", { className: "back-button", "data-tv-focusable": "true", onClick: onBack, type: "button", children: "\u2190 Back" }), _jsx("h1", { children: series.title }), _jsx("p", { className: "eyebrow", children: season.title || `Season ${season.seasonNumber}` }), season.synopsis && _jsx("p", { className: "synopsis", children: season.synopsis }), _jsxs("section", { className: "episode-section", children: [_jsx("h2", { children: "Episodes" }), _jsx(EpisodeRail, { api: api, episodes: season.episodes, progress: progress, series: series, season: season, onPlayEpisode: onPlayEpisode })] })] })] }));
}
