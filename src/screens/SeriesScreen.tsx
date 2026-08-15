import type { MediaApi } from '../api/MediaApi';
import { MediaCard } from '../components/MediaCard';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useAsync } from '../hooks/useAsync';
import type { SeasonSummary, ShowDetails } from '../types';

interface Props {
  api: MediaApi;
  seriesId: string;
  onBack: () => void;
  onOpenSeason: (season: SeasonSummary) => void;
}

export function SeriesScreen({ api, seriesId, onBack, onOpenSeason }: Props) {
  const details = useAsync(() => api.details(seriesId), [api, seriesId]);
  const show = details.value?.kind === 'show' && 'seasons' in details.value ? details.value as ShowDetails : undefined;
  const backdrop = useArtworkUrl(api, show?.artwork?.backdrop ?? show?.artwork?.poster);

  if (details.loading) return <Loading />;
  if (details.error) return <ErrorMessage error={details.error} />;
  if (!show) return <ErrorMessage error={new Error('Catalogue item is not a series.')} />;

  return (
    <section className="detail series-detail">
      {backdrop && <div className="detail-backdrop" style={{ backgroundImage: `url(${JSON.stringify(backdrop)})` }} />}
      <div className="detail-content series-content">
        <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Back</button>
        <p className="eyebrow">TV Series{show.year ? ` · ${show.year}` : ''}</p>
        <h1>{show.title}</h1>
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
