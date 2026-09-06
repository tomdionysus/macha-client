import type { MediaApi } from '../api/MediaApi';
import { EpisodeRail } from '../components/EpisodeRail';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useRefreshableAsync } from '../hooks/useRefreshableAsync';
import type { Episode, PlaybackProgress, SeasonDetails, ShowDetails } from '../types';
import { EditButton } from '../components/EditButton';
import { MediaPageTitle } from '../components/MediaPageTitle';

interface Props {
  api: MediaApi;
  seriesId: string;
  seasonId: string;
  onBack: () => void;
  progress: Map<string, PlaybackProgress>;
  onPlayEpisode: (episode: Episode, queue: Episode[], queueIndex: number, fromStart: boolean) => void;
  onEdit?: () => void;
}

export function SeasonScreen({ api, seriesId, seasonId, onBack, progress, onPlayEpisode, onEdit }: Props) {
  const result = useRefreshableAsync(async () => {
    const [seriesResult, seasonResult] = await Promise.all([api.details(seriesId), api.details(seasonId)]);
    if (seriesResult.kind !== 'show' || !('seasons' in seriesResult)) throw new Error('Parent catalogue item is not a series.');
    if (seasonResult.kind !== 'season' || !('episodes' in seasonResult)) throw new Error('Catalogue item is not a season.');
    const series = seriesResult as ShowDetails;
    const season = seasonResult as SeasonDetails;
    if (season.parentId && season.parentId !== series.id) throw new Error('Season does not belong to this series.');
    return { series, season };
  }, [api, seriesId, seasonId]);

  const season = result.value?.season;
  const series = result.value?.series;
  const artwork = season?.artwork?.backdrop
    ?? season?.artwork?.poster
    ?? series?.artwork?.backdrop
    ?? series?.artwork?.poster;
  const backdrop = useArtworkUrl(api, artwork);

  if (!result.value) return <section className="detail season-detail"><div className="detail-content season-content">
    <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Back</button>
    <MediaPageTitle refreshing={result.refreshing} onRefresh={result.refresh}>Season</MediaPageTitle>
    {result.loading ? <Loading /> : result.error ? <ErrorMessage error={result.error} /> : null}
  </div></section>;
  if (!season || !series) return null;

  return (
    <section className="detail season-detail">
      {backdrop && <div className="detail-backdrop season-backdrop" style={{ backgroundImage: `url(${JSON.stringify(backdrop)})` }} />}
      <div className="detail-content season-content">
        <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Back</button>
        {onEdit && <EditButton onClick={onEdit} />}
        <MediaPageTitle refreshing={result.refreshing} onRefresh={result.refresh}>{series.title}</MediaPageTitle>
        {result.error && <p className="manage-error media-refresh-error">Refresh failed: {result.error.message}</p>}
        <p className="eyebrow">{season.title || `Season ${season.seasonNumber}`}</p>
        {season.synopsis && <p className="synopsis">{season.synopsis}</p>}
        <section className="episode-section">
          <h2>Episodes</h2>
          <EpisodeRail api={api} episodes={season.episodes} progress={progress} onPlayEpisode={onPlayEpisode} />
        </section>
      </div>
    </section>
  );
}
