import type { MediaApi } from '@machafoundation/core';
import type { CatalogueMediaProfile } from '@machafoundation/core';
import { PlayIcon, RestartIcon } from '../components/PlaybackIcons';
import type { MediaDetails, MediaSummary, PlaybackProgress, PlaybackVersions, VersionStep } from '@machafoundation/core';
import { useAsync } from '../hooks/useAsync';
import { useRefreshableAsync } from '../hooks/useRefreshableAsync';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { requestTvDefaultFocus } from '../hooks/useTvNavigation';
import { buildPlatformTraits } from '../platform/traits';
import { useEffect } from 'react';
import { EditButton } from '../components/EditButton';
import { episodeCode, qualityLabel, qualityLimitText } from '../text/viewerText';
import { MediaPageTitle } from '../components/MediaPageTitle';

interface Props {
  api: MediaApi;
  itemId: string;
  onBack: () => void;
  onPlay: (item: MediaSummary) => void;
  onPlayFromStart: (item: MediaSummary) => void;
  /** The qualities to offer beside Play; absent offers Play alone. */
  loadVersions?: (item: MediaSummary) => Promise<PlaybackVersions>;
  onPlayVersion?: (item: MediaSummary, version: VersionStep) => void;
  progress?: PlaybackProgress;
  onEdit?: () => void;
  onMediaProfile?: (profile: CatalogueMediaProfile) => void;
}

function canPlayDirectly(details: MediaDetails): boolean {
  return details.kind === 'movie' || details.kind === 'episode' || details.kind === 'track';
}

/** A picture has qualities to pick between; a track's audio does not. */
function hasPicture(media: MediaSummary): boolean {
  return media.kind === 'movie' || media.kind === 'episode';
}

function canResume(media: MediaSummary, progress?: PlaybackProgress): boolean {
  return (media.kind === 'movie' || media.kind === 'episode')
    && Boolean(progress && progress.positionMs > 0 && progress.durationMs > 0);
}

function codecLabel(codec: string): string {
  const normalized = codec.trim().toLowerCase();
  if (normalized === 'h264') return 'H.264';
  if (normalized === 'hevc' || normalized === 'h265') return 'HEVC';
  if (normalized === 'aac') return 'AAC';
  if (normalized === 'ac3') return 'AC-3';
  if (normalized === 'eac3') return 'E-AC-3';
  return codec.toUpperCase();
}

export function mediaProfileSummary(profile: CatalogueMediaProfile): string {
  const parts: string[] = [];
  const minutes = Math.floor(profile.duration_ms / 60_000);
  if (minutes >= 60) parts.push(`${Math.floor(minutes / 60)}h ${minutes % 60}m`);
  else if (minutes > 0) parts.push(`${minutes}m`);
  const video = profile.streams.find((stream) => stream.type === 'video' && !stream.attached_picture);
  const audio = profile.streams.find((stream) => stream.type === 'audio');
  if (video?.width && video.height) parts.push(`${video.width}×${video.height}`);
  if (video?.codec) parts.push(codecLabel(video.codec));
  if (audio?.codec) parts.push(codecLabel(audio.codec));
  if (profile.bitrate > 0) parts.push(`${(profile.bitrate / 1_000_000).toFixed(1)} Mbps`);
  return parts.join(' · ');
}

export function DetailScreen({ api, itemId, onBack, onPlay, onPlayFromStart, loadVersions, onPlayVersion, progress, onEdit, onMediaProfile }: Props) {
  const details = useRefreshableAsync(() => api.details(itemId), [api, itemId]);
  const immutableMediaId = details.value?.mediaIds.find((mediaId) => mediaId.startsWith('macha:'));
  const profile = useAsync(
    (signal) => immutableMediaId && api.mediaProfile ? api.mediaProfile(immutableMediaId, signal) : Promise.resolve(undefined),
    [api, immutableMediaId],
  );
  const backdrop = useArtworkUrl(api, details.value?.artwork?.backdrop ?? details.value?.artwork?.poster ?? details.value?.artwork?.thumbnail);
  const poster = useArtworkUrl(api, details.value?.kind === 'movie' ? details.value.artwork?.poster : undefined);
  useEffect(() => {
    if (details.value && (details.value.kind === 'movie' || details.value.kind === 'episode' || details.value.kind === 'track')) requestTvDefaultFocus();
  }, [details.value]);
  useEffect(() => {
    if (profile.value) onMediaProfile?.(profile.value);
  }, [onMediaProfile, profile.value]);
  // Tom, 2026-09-25: Play stays and means "make the decision for me"; beside
  // it, one button per quality the item can be played at. Keyed on the
  // item, not the details object, so a background refresh does not ask again.
  const versionsFor = details.value && hasPicture(details.value) && details.value.mediaIds.length > 0 && onPlayVersion ? details.value : undefined;
  const versions = useAsync(
    () => versionsFor && loadVersions ? loadVersions(versionsFor) : Promise.resolve(undefined),
    [loadVersions, versionsFor?.id],
  );
  if (!details.value) return <section className="detail"><div className="detail-content">
    <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Back</button>
    <MediaPageTitle refreshing={details.refreshing} onRefresh={details.refresh}>Media</MediaPageTitle>
    {details.loading ? <Loading /> : details.error ? <ErrorMessage error={details.error} /> : null}
  </div></section>;

  const media = details.value;
  const playable = canPlayDirectly(media) && media.mediaIds.length > 0;
  const resumable = playable && canResume(media, progress);

  const copy = (
    <div className="detail-copy">
      <p className="eyebrow">{media.kind}{media.year ? ` · ${media.year}` : ''}</p>
      <MediaPageTitle refreshing={details.refreshing} onRefresh={details.refresh}>{media.title}</MediaPageTitle>
      {media.kind === 'episode' && episodeCode(media) && <p className="subtitle">{episodeCode(media)}</p>}
      {profile.value && <p className="media-profile-summary">{mediaProfileSummary(profile.value)}</p>}
      {media.synopsis && <p className="synopsis">{media.synopsis}</p>}
      {playable && (
        <div className="play-actions detail-play-controls" aria-label="Playback controls">
          <button
            className="media-control-button"
            data-tv-focusable="true"
            data-tv-default-focus={buildPlatformTraits.usesDpadNavigation ? 'true' : undefined}
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
          {onPlayVersion && versions.value?.steps.map((step) => {
            const label = qualityLabel(step.quality);
            return (
              <button
                key={step.quality}
                className="media-control-button media-quality-button"
                data-tv-focusable="true"
                onClick={() => onPlayVersion(media, step)}
                type="button"
                aria-label={resumable ? `Resume at ${label}` : `Play at ${label}`}
                title={resumable ? `Resume at ${label}` : `Play at ${label}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {playable && versions.value?.limitedBy && <p className="media-quality-note">{qualityLimitText(versions.value.limitedBy)}</p>}
    </div>
  );

  return (
    <section className={`detail ${media.kind === 'movie' ? 'movie-detail' : ''}`}>
      {backdrop && <div className="detail-backdrop" style={{ backgroundImage: `url(${JSON.stringify(backdrop)})` }} />}
      <div className="detail-content">
        <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Back</button>
        {onEdit && <EditButton onClick={onEdit} />}
        {details.error && <p className="manage-error media-refresh-error">Refresh failed: {details.error.message}</p>}
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
