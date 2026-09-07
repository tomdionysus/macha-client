import type { MediaApi } from '@macha/core';
import { MediaCard } from '../components/MediaCard';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useRefreshableAsync } from '../hooks/useRefreshableAsync';
import type { SeasonSummary, ShowDetails } from '@macha/core';
import { EditButton } from '../components/EditButton';
import { MediaPageTitle } from '../components/MediaPageTitle';

interface Props {
  api: MediaApi;
  seriesId: string;
  onBack: () => void;
  onOpenSeason: (season: SeasonSummary) => void;
  onEdit?: () => void;
}

export function SeriesScreen({ api, seriesId, onBack, onOpenSeason, onEdit }: Props) {
  const details = useRefreshableAsync(() => api.details(seriesId), [api, seriesId]);
  const show = details.value?.kind === 'show' && 'seasons' in details.value ? details.value as ShowDetails : undefined;
  const backdrop = useArtworkUrl(api, show?.artwork?.backdrop ?? show?.artwork?.poster);

  if (!details.value) return <section className="detail series-detail"><div className="detail-content series-content">
    <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Back</button>
    <MediaPageTitle refreshing={details.refreshing} onRefresh={details.refresh}>TV Series</MediaPageTitle>
    {details.loading ? <Loading /> : details.error ? <ErrorMessage error={details.error} /> : null}
  </div></section>;
  if (!show) return <ErrorMessage error={new Error('Catalogue item is not a series.')} />;

  return (
    <section className="detail series-detail">
      {backdrop && <div className="detail-backdrop" style={{ backgroundImage: `url(${JSON.stringify(backdrop)})` }} />}
      <div className="detail-content series-content">
        <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Back</button>
        {onEdit && <EditButton onClick={onEdit} />}
        <p className="eyebrow">TV Series{show.year ? ` · ${show.year}` : ''}</p>
        <MediaPageTitle refreshing={details.refreshing} onRefresh={details.refresh}>{show.title}</MediaPageTitle>
        {details.error && <p className="manage-error media-refresh-error">Refresh failed: {details.error.message}</p>}
        {show.synopsis && <p className="synopsis">{show.synopsis}</p>}
        <section className="media-section season-section">
          <h2>Seasons</h2>
          <div className="media-row season-row">
            {show.seasons.map((season) => (
              <MediaCard key={season.id} api={api} item={season} onOpen={() => onOpenSeason(season)} />
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
