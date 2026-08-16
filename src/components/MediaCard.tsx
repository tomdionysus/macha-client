import { Link } from 'react-router-dom';
import type { MediaApi } from '../api/MediaApi';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { routes } from '../routing';
import type { MediaSummary } from '../types';

interface Props {
  api: MediaApi;
  item: MediaSummary;
  onOpen: (item: MediaSummary) => void;
  progress?: number;
  variant?: 'default' | 'continue-watching';
}

function artworkClass(item: MediaSummary): string {
  return item.kind === 'album' || item.kind === 'artist' || item.kind === 'track' ? 'poster music-artwork' : 'poster';
}

function Poster({ api, item, progress }: Pick<Props, 'api' | 'item' | 'progress'>) {
  const image = useArtworkUrl(api, item.artwork?.poster ?? item.artwork?.thumbnail);
  return (
    <div className={artworkClass(item)}>
      {image ? <img src={image} alt="" loading="lazy" /> : <div className="poster-placeholder">{item.title.slice(0, 1)}</div>}
      {progress !== undefined && progress > 0 && (
        <div className="progress-track"><div className="progress-value" style={{ width: `${Math.min(100, progress * 100)}%` }} /></div>
      )}
    </div>
  );
}

function ContinueWatchingEpisodeCard({ api, item, onOpen, progress }: Props) {
  const context = item.playbackContext;
  if (!context) throw new Error(`Continue Watching episode ${item.id} is missing playback hierarchy context.`);

  const seasonLabel = item.subtitle
    ? `${context.season.title} · ${item.subtitle}`
    : context.season.title;

  return (
    <article className="media-card media-card-episode continue-card">
      <button
        type="button"
        className="continue-card-open"
        data-tv-focusable="true"
        onClick={() => onOpen(item)}
        aria-label={`Resume ${item.title}`}
      >
        <Poster api={api} item={item} progress={progress} />
        <span className="card-title continue-card-title">{item.title}</span>
      </button>
      <div className="continue-card-context">
        <Link
          to={routes.show(context.series.id)}
          data-tv-focusable="true"
          className="continue-card-context-link"
        >
          {context.series.title}
        </Link>
        <Link
          to={routes.season(context.series.id, context.season.id)}
          data-tv-focusable="true"
          className="continue-card-context-link"
        >
          {seasonLabel}
        </Link>
      </div>
    </article>
  );
}

export function MediaCard({ api, item, onOpen, progress, variant = 'default' }: Props) {
  if (variant === 'continue-watching' && item.kind === 'episode') {
    return <ContinueWatchingEpisodeCard api={api} item={item} onOpen={onOpen} progress={progress} variant={variant} />;
  }

  return (
    <button className={`media-card media-card-${item.kind}`} data-tv-focusable="true" onClick={() => onOpen(item)}>
      <Poster api={api} item={item} progress={progress} />
      <span className="card-title">{item.title}</span>
      {(item.subtitle || item.year) && <span className="card-subtitle">{item.subtitle ?? item.year}</span>}
    </button>
  );
}
