import type { MediaApi } from '../api/MediaApi';
import type { MediaSummary, PlaybackProgress } from '../types';
import { MediaCard } from './MediaCard';

interface Props {
  api: MediaApi;
  title: string;
  items: MediaSummary[];
  onOpen: (item: MediaSummary) => void;
  progress?: Map<string, PlaybackProgress>;
}

export function MediaRow({ api, title, items, onOpen, progress }: Props) {
  if (items.length === 0) return null;
  return (
    <section className="media-section">
      <h2>{title}</h2>
      <div className="media-row">
        {items.map((item) => {
          const entry = progress?.get(item.id);
          const ratio = entry && entry.durationMs > 0 ? entry.positionMs / entry.durationMs : undefined;
          return <MediaCard key={item.id} api={api} item={item} onOpen={onOpen} progress={ratio} />;
        })}
      </div>
    </section>
  );
}
