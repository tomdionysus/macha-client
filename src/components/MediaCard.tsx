import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MediaApi } from '../api/MediaApi';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { routes } from '../routing';
import type { MediaSummary } from '../types';

interface Props {
  api: MediaApi;
  item: MediaSummary;
  onOpen: (item: MediaSummary) => void;
  onRemoveFromContinueWatching?: (item: MediaSummary) => void;
  progress?: number;
  variant?: 'default' | 'continue-watching';
  elementRef?: (element: HTMLButtonElement | null) => void;
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

function ContinueWatchingMenu({ item, onRemove }: { item: MediaSummary; onRemove: (item: MediaSummary) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    removeRef.current?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      void Promise.resolve().then(() => triggerRef.current?.focus());
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="continue-card-menu">
      <button
        ref={triggerRef}
        type="button"
        className="continue-card-menu-trigger"
        data-tv-focusable="true"
        aria-label={`More options for ${item.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div className="continue-card-menu-popover" role="menu">
          <button
            ref={removeRef}
            type="button"
            role="menuitem"
            data-tv-focusable="true"
            onClick={() => {
              setOpen(false);
              onRemove(item);
            }}
            aria-label={`Remove ${item.title} from Continue Watching`}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function ContinueWatchingEpisodeCard({ api, item, onOpen, onRemoveFromContinueWatching, progress, elementRef }: Props) {
  const context = item.playbackContext;
  if (!context) throw new Error(`Continue Watching episode ${item.id} is missing playback hierarchy context.`);

  const seasonLabel = item.subtitle
    ? `${context.season.title} · ${item.subtitle}`
    : context.season.title;

  return (
    <article className="media-card media-card-episode continue-card">
      <button
        type="button"
        ref={elementRef}
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
      {onRemoveFromContinueWatching && <ContinueWatchingMenu item={item} onRemove={onRemoveFromContinueWatching} />}
    </article>
  );
}

function ContinueWatchingCard({ api, item, onOpen, onRemoveFromContinueWatching, progress, elementRef }: Props) {
  return (
    <article className={`media-card media-card-${item.kind} continue-card`}>
      <button
        type="button"
        ref={elementRef}
        className="continue-card-open"
        data-tv-focusable="true"
        onClick={() => onOpen(item)}
        aria-label={`Resume ${item.title}`}
      >
        <Poster api={api} item={item} progress={progress} />
        <span className="card-title">{item.title}</span>
        {(item.subtitle || item.year) && <span className="card-subtitle">{item.subtitle ?? item.year}</span>}
      </button>
      {onRemoveFromContinueWatching && <ContinueWatchingMenu item={item} onRemove={onRemoveFromContinueWatching} />}
    </article>
  );
}

export function MediaCard({ api, item, onOpen, onRemoveFromContinueWatching, progress, variant = 'default', elementRef }: Props) {
  if (variant === 'continue-watching') {
    if (item.kind === 'episode') {
      return (
        <ContinueWatchingEpisodeCard
          api={api}
          item={item}
          onOpen={onOpen}
          onRemoveFromContinueWatching={onRemoveFromContinueWatching}
          progress={progress}
          variant={variant}
          elementRef={elementRef}
        />
      );
    }

    return (
      <ContinueWatchingCard
        api={api}
        item={item}
        onOpen={onOpen}
        onRemoveFromContinueWatching={onRemoveFromContinueWatching}
        progress={progress}
        variant={variant}
        elementRef={elementRef}
      />
    );
  }

  return (
    <button ref={elementRef} className={`media-card media-card-${item.kind}`} data-tv-focusable="true" onClick={() => onOpen(item)}>
      <Poster api={api} item={item} progress={progress} />
      <span className="card-title">{item.title}</span>
      {(item.subtitle || item.year) && <span className="card-subtitle">{item.subtitle ?? item.year}</span>}
    </button>
  );
}
