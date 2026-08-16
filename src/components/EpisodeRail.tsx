import { useRef, type MouseEvent, type PointerEvent, type WheelEvent } from 'react';
import { Link } from 'react-router-dom';
import type { MediaApi } from '../api/MediaApi';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { PlayIcon, RestartIcon } from './PlaybackIcons';
import { routes } from '../routing';
import type { Episode, PlaybackProgress } from '../types';

interface Props {
  api: MediaApi;
  episodes: Episode[];
  progress: Map<string, PlaybackProgress>;
}

interface DragState {
  pointerId: number;
  startX: number;
  startScrollLeft: number;
  moved: boolean;
  captured: boolean;
}

function displayDate(value?: string): string {
  if (!value) return 'Air date unavailable';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
}

function resumable(progress?: PlaybackProgress): boolean {
  return Boolean(progress && progress.positionMs > 0 && progress.durationMs > 0);
}

function EpisodeCard({ api, episode, progress }: { api: MediaApi; episode: Episode; progress?: PlaybackProgress }) {
  const image = useArtworkUrl(api, episode.artwork?.thumbnail ?? episode.artwork?.backdrop);
  const hasProgress = resumable(progress);
  return (
    <article className={`episode-card${hasProgress ? ' has-progress' : ''}`}>
      <div className="episode-still-shell">
        <Link
          className="episode-still-link"
          to={routes.player(episode.id)}
          data-tv-focusable="true"
          aria-label={`${hasProgress ? 'Resume' : 'Play'} ${episode.title}`}
          draggable={false}
        >
          <div className="episode-still">
            {image
              ? <img src={image} alt="" loading="lazy" draggable={false} />
              : <div className="episode-still-placeholder">{episode.episodeNumber}</div>}
            {progress && progress.durationMs > 0 && (
              <div className="episode-progress-track" aria-hidden="true">
                <div className="episode-progress-value" style={{ width: `${Math.min(100, progress.positionMs / progress.durationMs * 100)}%` }} />
              </div>
            )}
          </div>
        </Link>
        <div className="episode-play-actions" aria-hidden={!hasProgress}>
          <span className="episode-play-action episode-play-resume" aria-hidden="true"><PlayIcon /></span>
          {hasProgress && (
            <Link
              className="episode-play-action episode-play-restart"
              to={routes.playerFromStart(episode.id)}
              data-tv-focusable="true"
              aria-label={`Play ${episode.title} from start`}
              draggable={false}
            >
              <RestartIcon />
            </Link>
          )}
        </div>
      </div>
      <div className="episode-copy">
        <div className="episode-heading">
          <strong>{episode.episodeNumber}. {episode.title}</strong>
          <span>{displayDate(episode.releaseDate)}</span>
        </div>
        <p>{episode.synopsis || 'No description available.'}</p>
      </div>
    </article>
  );
}

export function EpisodeRail({ api, episodes, progress }: Props) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState>();
  const suppressClick = useRef(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (!rail || event.pointerType === 'mouse' && event.button !== 0) return;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: rail.scrollLeft,
      moved: false,
      captured: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    const state = drag.current;
    if (!rail || !state || state.pointerId !== event.pointerId) return;
    const delta = event.clientX - state.startX;
    if (Math.abs(delta) > 6) state.moved = true;
    if (!state.moved) return;

    if (!state.captured) {
      rail.setPointerCapture(event.pointerId);
      state.captured = true;
    }
    event.preventDefault();
    rail.scrollLeft = state.startScrollLeft - delta;
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    const state = drag.current;
    if (!rail || !state || state.pointerId !== event.pointerId) return;
    suppressClick.current = state.moved;
    drag.current = undefined;
    if (state.captured && rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
    if (suppressClick.current) {
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (!rail || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    if (rail.scrollWidth <= rail.clientWidth) return;
    event.preventDefault();
    rail.scrollLeft += event.deltaY;
  };

  return (
    <div
      ref={railRef}
      className="episode-rail"
      role="list"
      aria-label="Episodes"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onClickCapture={onClickCapture}
      onWheel={onWheel}
    >
      {episodes.map((episode) => (
        <div key={episode.id} className="episode-rail-item" role="listitem">
          <EpisodeCard api={api} episode={episode} progress={progress.get(episode.id)} />
        </div>
      ))}
    </div>
  );
}
