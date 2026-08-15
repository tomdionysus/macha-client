import type { MediaApi } from '../api/MediaApi';
import type { MediaDetails, MediaSummary } from '../types';
import { useAsync } from '../hooks/useAsync';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';

interface Props {
  api: MediaApi;
  itemId: string;
  onBack: () => void;
  onPlay: (item: MediaSummary) => void;
}

function canPlayDirectly(details: MediaDetails): boolean {
  return details.kind === 'movie' || details.kind === 'episode' || details.kind === 'track';
}

export function DetailScreen({ api, itemId, onBack, onPlay }: Props) {
  const details = useAsync(() => api.details(itemId), [api, itemId]);
  const backdrop = useArtworkUrl(api, details.value?.artwork?.backdrop ?? details.value?.artwork?.poster);
  if (details.loading) return <Loading />;
  if (details.error) return <ErrorMessage error={details.error} />;
  if (!details.value) return null;

  const media = details.value;
  const playable = canPlayDirectly(media) && media.mediaIds.length > 0;

  return (
    <section className="detail">
      {backdrop && <div className="detail-backdrop" style={{ backgroundImage: `url(${JSON.stringify(backdrop)})` }} />}
      <div className="detail-content">
        <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Back</button>
        <p className="eyebrow">{media.kind}{media.year ? ` · ${media.year}` : ''}</p>
        <h1>{media.title}</h1>
        {media.subtitle && <p className="subtitle">{media.subtitle}</p>}
        {media.synopsis && <p className="synopsis">{media.synopsis}</p>}
        {playable && (
          <button className="primary-button" data-tv-focusable="true" onClick={() => onPlay(media)} type="button">▶ Play</button>
        )}
      </div>
    </section>
  );
}
