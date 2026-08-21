import type { MediaApi } from '../api/MediaApi';
import { PlayIcon, RestartIcon } from '../components/PlaybackIcons';
import type { MediaDetails, MediaSummary, PlaybackProgress } from '../types';
import { useAsync } from '../hooks/useAsync';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { EditButton } from '../components/EditButton';

interface Props {
  api: MediaApi;
  itemId: string;
  onBack: () => void;
  onPlay: (item: MediaSummary) => void;
  onPlayFromStart: (item: MediaSummary) => void;
  progress?: PlaybackProgress;
  onEdit?: () => void;
}

function canPlayDirectly(details: MediaDetails): boolean {
  return details.kind === 'movie' || details.kind === 'episode' || details.kind === 'track';
}

function canResume(media: MediaSummary, progress?: PlaybackProgress): boolean {
  return (media.kind === 'movie' || media.kind === 'episode')
    && Boolean(progress && progress.positionMs > 0 && progress.durationMs > 0);
}

export function DetailScreen({ api, itemId, onBack, onPlay, onPlayFromStart, progress, onEdit }: Props) {
  const details = useAsync(() => api.details(itemId), [api, itemId]);
  const backdrop = useArtworkUrl(api, details.value?.artwork?.backdrop ?? details.value?.artwork?.poster ?? details.value?.artwork?.thumbnail);
  const poster = useArtworkUrl(api, details.value?.kind === 'movie' ? details.value.artwork?.poster : undefined);
  if (details.loading) return <Loading />;
  if (details.error) return <ErrorMessage error={details.error} />;
  if (!details.value) return null;

  const media = details.value;
  const playable = canPlayDirectly(media) && media.mediaIds.length > 0;
  const resumable = playable && canResume(media, progress);

  const copy = (
    <div className="detail-copy">
      <p className="eyebrow">{media.kind}{media.year ? ` · ${media.year}` : ''}</p>
      <h1>{media.title}</h1>
      {media.subtitle && <p className="subtitle">{media.subtitle}</p>}
      {media.synopsis && <p className="synopsis">{media.synopsis}</p>}
      {playable && (
        <div className="play-actions detail-play-controls" aria-label="Playback controls">
          <button
            className="media-control-button"
            data-tv-focusable="true"
            onClick={() => onPlay(media)}
            type="button"
            aria-label={resumable ? 'Resume playback' : 'Play'}
            title={resumable ? 'Resume playback' : 'Play'}
          >
            <PlayIcon />
          </button>
          {resumable && (
            <button
              className="media-control-button"
              data-tv-focusable="true"
              onClick={() => onPlayFromStart(media)}
              type="button"
              aria-label="Play from start"
              title="Play from start"
            >
              <RestartIcon />
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <section className={`detail ${media.kind === 'movie' ? 'movie-detail' : ''}`}>
      {backdrop && <div className="detail-backdrop" style={{ backgroundImage: `url(${JSON.stringify(backdrop)})` }} />}
      <div className="detail-content">
        <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Back</button>
        {onEdit && <EditButton onClick={onEdit} />}
        {media.kind === 'movie' ? (
          <div className={`movie-detail-layout ${poster ? 'has-poster' : ''}`}>
            <div className="movie-detail-poster" aria-hidden="true">
              {poster ? <img src={poster} alt="" /> : <div className="movie-detail-poster-placeholder">{media.title.slice(0, 1)}</div>}
            </div>
            {copy}
          </div>
        ) : copy}
      </div>
    </section>
  );
}
