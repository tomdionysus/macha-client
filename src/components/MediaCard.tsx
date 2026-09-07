import { Link } from 'react-router-dom';
import type { MediaApi } from '@macha/core';
import { routes } from '@macha/core';
import type { MediaSummary } from '@macha/core';
import { CardCloseButton } from './CardCloseButton';
import { LazyArtwork } from './LazyArtwork';
import { OverflowMenu, type OverflowMenuAction } from './OverflowMenu';

export interface MediaCardAction {
  label: string;
  onSelect: (item: MediaSummary) => void;
  disabled?: boolean;
  destructive?: boolean;
}

interface Props {
  api: MediaApi;
  item: MediaSummary;
  onOpen: (item: MediaSummary) => void;
  onRemoveFromContinueWatching?: (item: MediaSummary) => void;
  actions?: readonly MediaCardAction[];
  progress?: number;
  variant?: 'default' | 'continue-watching';
  elementRef?: (element: HTMLButtonElement | null) => void;
}

function artworkClass(item: MediaSummary): string {
  return item.kind === 'album' || item.kind === 'artist' || item.kind === 'track' ? 'poster music-artwork' : 'poster';
}

function Poster({ api, item, progress }: Pick<Props, 'api' | 'item' | 'progress'>) {
  return (
    <div className={artworkClass(item)}>
      <LazyArtwork
        api={api}
        artwork={item.artwork?.poster ?? item.artwork?.thumbnail}
        alt={item.title}
        placeholder={<div className="poster-placeholder">{item.title.slice(0, 1)}</div>}
      />
      {progress !== undefined && progress > 0 && (
        <div className="progress-track"><div className="progress-value" style={{ width: `${Math.min(100, progress * 100)}%` }} /></div>
      )}
    </div>
  );
}

function actionItems(item: MediaSummary, actions: readonly MediaCardAction[]): OverflowMenuAction[] {
  return actions.map((action) => ({
    label: action.label,
    disabled: action.disabled,
    destructive: action.destructive,
    onSelect: () => action.onSelect(item),
  }));
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
      {onRemoveFromContinueWatching && (
        <CardCloseButton
          className="continue-card-remove"
          label={`Remove ${item.title} from Continue Watching`}
          onClick={() => onRemoveFromContinueWatching(item)}
        />
      )}
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
      {onRemoveFromContinueWatching && (
        <CardCloseButton
          className="continue-card-remove"
          label={`Remove ${item.title} from Continue Watching`}
          onClick={() => onRemoveFromContinueWatching(item)}
        />
      )}
    </article>
  );
}

function ActionableMediaCard({ api, item, onOpen, actions = [], progress, elementRef }: Props) {
  return (
    <article className={`media-card media-card-${item.kind} continue-card media-card-actionable`}>
      <button
        type="button"
        ref={elementRef}
        className="continue-card-open"
        data-tv-focusable="true"
        onClick={() => onOpen(item)}
        aria-label={`Play ${item.title} now`}
      >
        <Poster api={api} item={item} progress={progress} />
        <span className="card-title">{item.title}</span>
        {(item.subtitle || item.year) && <span className="card-subtitle">{item.subtitle ?? item.year}</span>}
      </button>
      <OverflowMenu
        className="card-overflow-menu"
        label={`More options for ${item.title}`}
        actions={actionItems(item, actions)}
      />
    </article>
  );
}

export function MediaCard({ api, item, onOpen, onRemoveFromContinueWatching, actions, progress, variant = 'default', elementRef }: Props) {
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

  if (actions?.length) {
    return (
      <ActionableMediaCard
        api={api}
        item={item}
        onOpen={onOpen}
        actions={actions}
        progress={progress}
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
