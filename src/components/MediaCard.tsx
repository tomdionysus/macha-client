import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import type { MediaApi } from '@machafoundation/core';
import { albumLabel, episodeLabel, routes, trackNumberLabel } from '@machafoundation/core';
import type { MediaSummary } from '@machafoundation/core';
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
  /** `in-context` names an episode's series and season, or a track's artist and album, for a list that is neither's. */
  variant?: 'default' | 'continue-watching' | 'in-context';
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

type ContextLink = { to: string; label: string };

/**
 * Where an item sits, each step linking to its page, one line per entry: an
 * episode's series, then "Season x Episode y"; a track's "Artist - Album
 * (year)" on one line. For an item shown away from its parent (Continue
 * Watching, search); a season or album page already says both, so its rows
 * never ask for this.
 */
function contextLines(item: MediaSummary): ContextLink[][] | undefined {
  if (item.kind === 'episode' && item.playbackContext) {
    const { series, season } = item.playbackContext;
    return [
      [{ to: routes.show(series.id), label: series.title }],
      [{ to: routes.season(series.id, season.id), label: episodeLabel(item) ?? season.title }],
    ];
  }
  if (item.kind === 'track' && item.musicContext) {
    const { artist, album } = item.musicContext;
    return [[
      ...(artist ? [{ to: routes.artist(artist.id), label: artist.title }] : []),
      { to: routes.album(album.id), label: albumLabel(item.musicContext) },
    ]];
  }
  return undefined;
}

function ContextLinks({ lines }: { lines: ReadonlyArray<ReadonlyArray<ContextLink>> }) {
  return (
    <div className="continue-card-context">
      {lines.map((line) => (
        <span key={line.map((link) => link.to).join(' ')} className="continue-card-context-line">
          {line.map((link, index) => (
            <Fragment key={link.to}>
              {index > 0 && ' - '}
              <Link to={link.to} data-tv-focusable="true" className="continue-card-context-link">{link.label}</Link>
            </Fragment>
          ))}
        </span>
      ))}
    </div>
  );
}

function ContinueWatchingEpisodeCard({ api, item, onOpen, onRemoveFromContinueWatching, progress, elementRef }: Props) {
  if (!item.playbackContext) throw new Error(`Continue Watching episode ${item.id} is missing playback hierarchy context.`);
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
      <ContextLinks lines={contextLines(item) ?? []} />
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

/**
 * A search hit that belongs to something: the card opens it, the links go to
 * its parents. A track keeps its own "Track 9" under them; an episode's label
 * is already its season link.
 */
function InContextCard({ api, item, onOpen, elementRef, lines }: Props & { lines: ContextLink[][] }) {
  return (
    <article className={`media-card media-card-${item.kind} continue-card`}>
      <button
        type="button"
        ref={elementRef}
        className="continue-card-open"
        data-tv-focusable="true"
        onClick={() => onOpen(item)}
        aria-label={`Play ${item.title}`}
      >
        <Poster api={api} item={item} />
        <span className="card-title">{item.title}</span>
      </button>
      <ContextLinks lines={lines} />
      {item.kind === 'track' && trackNumberLabel(item) && <span className="card-subtitle">{trackNumberLabel(item)}</span>}
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
        {item.kind === 'track' && item.musicContext ? (
          // Tom, 2026-09-24: on Music the artist sits below the album name, for
          // tracks as for albums (whose subtitle core now makes the artist).
          <>
            <span className="card-subtitle">{item.musicContext.album.title}</span>
            {item.musicContext.artist && <span className="card-subtitle">{item.musicContext.artist.title}</span>}
          </>
        ) : (item.subtitle || item.year) && <span className="card-subtitle">{item.subtitle ?? item.year}</span>}
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

  const lines = variant === 'in-context' ? contextLines(item) : undefined;
  if (lines) return <InContextCard api={api} item={item} onOpen={onOpen} elementRef={elementRef} lines={lines} />;

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
