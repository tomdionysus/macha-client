import type { MediaApi } from '../api/MediaApi';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import type { MediaSummary } from '../types';

interface Props {
  api: MediaApi;
  item: MediaSummary;
  onOpen: (item: MediaSummary) => void;
  progress?: number;
}

function artworkClass(item: MediaSummary): string {
  return item.kind === 'album' || item.kind === 'artist' || item.kind === 'track' ? 'poster music-artwork' : 'poster';
}

export function MediaCard({ api, item, onOpen, progress }: Props) {
  const image = useArtworkUrl(api, item.artwork?.poster ?? item.artwork?.thumbnail);
  return (
    <button className={`media-card media-card-${item.kind}`} data-tv-focusable="true" onClick={() => onOpen(item)}>
      <div className={artworkClass(item)}>
        {image ? <img src={image} alt="" loading="lazy" /> : <div className="poster-placeholder">{item.title.slice(0, 1)}</div>}
        {progress !== undefined && progress > 0 && (
          <div className="progress-track"><div className="progress-value" style={{ width: `${Math.min(100, progress * 100)}%` }} /></div>
        )}
      </div>
      <span className="card-title">{item.title}</span>
      {(item.subtitle || item.year) && <span className="card-subtitle">{item.subtitle ?? item.year}</span>}
    </button>
  );
}
