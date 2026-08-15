import { useRef, type MouseEvent, type PointerEvent, type WheelEvent } from 'react';
import type { MediaApi } from '../api/MediaApi';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import type { Episode } from '../types';

interface Props {
  api: MediaApi;
  episodes: Episode[];
  onOpen: (episode: Episode) => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startScrollLeft: number;
  moved: boolean;
}

function displayDate(value?: string): string {
  if (!value) return 'Air date unavailable';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
}

function EpisodeCard({ api, episode, onOpen }: { api: MediaApi; episode: Episode; onOpen: (episode: Episode) => void }) {
  const image = useArtworkUrl(api, episode.artwork?.thumbnail ?? episode.artwork?.backdrop);
  return (
    <button
      className="episode-card"
      data-tv-focusable="true"
      aria-label={`Play ${episode.title}`}
      onClick={() => onOpen(episode)}
      type="button"
    >
      <div className="episode-still">
        {image
          ? <img src={image} alt="" loading="lazy" />
          : <div className="episode-still-placeholder">{episode.episodeNumber}</div>}
        <span className="episode-play-mark" aria-hidden="true">▶</span>
      </div>
      <div className="episode-copy">
        <div className="episode-heading">
          <strong>{episode.episodeNumber}. {episode.title}</strong>
          <span>{displayDate(episode.releaseDate)}</span>
        </div>
        <p>{episode.synopsis || 'No description available.'}</p>
      </div>
    </button>
  );
}

export function EpisodeRail({ api, episodes, onOpen }: Props) {
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
    };
    rail.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    const state = drag.current;
    if (!rail || !state || state.pointerId !== event.pointerId) return;
    const delta = event.clientX - state.startX;
    if (Math.abs(delta) > 6) state.moved = true;
    if (state.moved) {
      event.preventDefault();
      rail.scrollLeft = state.startScrollLeft - delta;
    }
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    const state = drag.current;
    if (!rail || !state || state.pointerId !== event.pointerId) return;
    suppressClick.current = state.moved;
    drag.current = undefined;
    if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
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
          <EpisodeCard api={api} episode={episode} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}
