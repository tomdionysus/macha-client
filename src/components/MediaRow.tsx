import type { MediaApi } from '@macha/core';
import type { MediaSummary, PlaybackProgress } from '@macha/core';
import { MediaCard } from './MediaCard';

interface Props {
  api: MediaApi;
  title: string;
  items: MediaSummary[];
  onOpen: (item: MediaSummary) => void;
  onRemoveFromContinueWatching?: (item: MediaSummary) => void;
  progress?: Map<string, PlaybackProgress>;
  variant?: 'default' | 'continue-watching';
  itemRef?: (itemId: string, element: HTMLButtonElement | null) => void;
}

export function MediaRow({ api, title, items, onOpen, onRemoveFromContinueWatching, progress, variant = 'default', itemRef }: Props) {
  if (items.length === 0) return null;
  return (
    <section className="media-section">
      <h2>{title}</h2>
      <div className="media-row">
        {items.map((item) => {
          const entry = progress?.get(item.id);
          const ratio = entry && entry.durationMs > 0 ? entry.positionMs / entry.durationMs : undefined;
          return (
            <MediaCard
              key={item.id}
              api={api}
              item={item}
              onOpen={onOpen}
              onRemoveFromContinueWatching={onRemoveFromContinueWatching}
              progress={ratio}
              variant={variant}
              elementRef={itemRef ? (element) => itemRef(item.id, element) : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}
