import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import type { MediaApi } from '../api/MediaApi';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useAsync } from '../hooks/useAsync';
import type { Platform } from '../platform/Platform';
import type { PlaybackResolver } from '../playback/PlaybackResolver';
import { uiSettings } from '../settings';
import type { MediaSummary, PlaybackEvent, PlaybackProgress } from '../types';

interface Props {
  api: MediaApi;
  itemId: string;
  platform: Platform;
  playbackResolver: PlaybackResolver;
  startPositionMs: number;
  onProgress: (progress: PlaybackProgress) => void;
  onBack: () => void;
}

const VIDEO_PREVIEW_DURATION_MS = 45 * 60 * 1000;
const AUDIO_PREVIEW_DURATION_MS = 4 * 60 * 1000;

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function canPlay(media: MediaSummary): boolean {
  return media.kind === 'movie' || media.kind === 'episode' || media.kind === 'track';
}

function shouldTrackProgress(media: MediaSummary): boolean {
  return media.kind === 'movie' || media.kind === 'episode';
}

function PlayerSession({ api, media, platform, playbackResolver, startPositionMs, onProgress, onBack }: Omit<Props, 'itemId'> & { media: MediaSummary }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const player = useMemo(() => platform.createPlayer(), [platform]);
  const mockMode = !playbackResolver.available;
  const previewDuration = media.durationMs ?? (media.kind === 'track' ? AUDIO_PREVIEW_DURATION_MS : VIDEO_PREVIEW_DURATION_MS);
  const initialEvent = useMemo<PlaybackEvent>(() => ({
    positionMs: Math.min(startPositionMs, previewDuration),
    durationMs: previewDuration,
    paused: false,
    ended: false,
  }), [previewDuration, startPositionMs]);
  const latestRef = useRef(initialEvent);
  const lastReportRef = useRef(0);
  const hideTimerRef = useRef<number>();
  const [event, setEvent] = useState(initialEvent);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playbackNotice, setPlaybackNotice] = useState<string | undefined>(
    mockMode ? 'Player preview — Macha streaming API not implemented yet.' : undefined,
  );
  const backdrop = useArtworkUrl(api, media.artwork?.backdrop ?? media.artwork?.thumbnail ?? media.artwork?.poster);
  const cover = useArtworkUrl(api, media.kind === 'track' ? media.artwork?.poster ?? media.artwork?.thumbnail : undefined);

  const publish = useCallback((next: PlaybackEvent) => {
    latestRef.current = next;
    setEvent(next);
    if (!shouldTrackProgress(media)) return;
    const now = Date.now();
    if (next.ended || now - lastReportRef.current >= 10_000) {
      lastReportRef.current = now;
      onProgress({
        mediaId: media.id,
        positionMs: next.positionMs,
        durationMs: next.durationMs || previewDuration,
        updatedAt: now,
        media,
      });
    }
  }, [media, onProgress, previewDuration]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    if (!latestRef.current.paused) {
      hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), uiSettings.playerControlsHideDelayMs);
    }
  }, []);

  useEffect(() => {
    showControls();
    return () => {
      if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    };
  }, [showControls]);

  useEffect(() => {
    if (mockMode) return;
    const host = hostRef.current;
    if (!host) return;
    let active = true;
    player.attach(host);
    const unsubscribe = player.subscribe((next) => {
      if (!active) return;
      publish(next);
    });

    void (async () => {
      try {
        const capabilities = await platform.capabilities();
        const source = await playbackResolver.resolve(media, capabilities);
        if (!active) return;
        await player.play(source, startPositionMs);
      } catch (error) {
        if (!active) return;
        setPlaybackNotice(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      active = false;
      unsubscribe();
      player.detach();
    };
  }, [media, mockMode, platform, playbackResolver, player, publish, startPositionMs]);

  useEffect(() => {
    if (!mockMode || event.paused || event.ended) return;
    const timer = window.setInterval(() => {
      const previous = latestRef.current;
      const positionMs = Math.min(previous.durationMs, previous.positionMs + 1_000);
      publish({
        ...previous,
        positionMs,
        ended: positionMs >= previous.durationMs,
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [event.ended, event.paused, mockMode, publish]);

  useEffect(() => () => {
    if (!shouldTrackProgress(media)) return;
    const latest = latestRef.current;
    onProgress({
      mediaId: media.id,
      positionMs: latest.positionMs,
      durationMs: latest.durationMs || previewDuration,
      updatedAt: Date.now(),
      media,
    });
  }, [media, onProgress, previewDuration]);

  const setPaused = useCallback((paused: boolean) => {
    if (!mockMode) {
      if (paused) player.pause();
      else player.resume();
    }
    publish({ ...latestRef.current, paused });
    if (paused) {
      setControlsVisible(true);
      if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    } else {
      showControls();
    }
  }, [mockMode, player, publish, showControls]);

  const seek = useCallback((positionMs: number) => {
    const durationMs = latestRef.current.durationMs || previewDuration;
    const bounded = Math.max(0, Math.min(durationMs, positionMs));
    if (!mockMode) player.seek(bounded);
    publish({ ...latestRef.current, positionMs: bounded, ended: false });
    showControls();
  }, [mockMode, player, previewDuration, publish, showControls]);

  useEffect(() => {
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape' || keyEvent.key === 'Backspace') {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        onBack();
        return;
      }
      if (keyEvent.key === 'MediaPlayPause' || keyEvent.key === ' ') {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        setPaused(!latestRef.current.paused);
        return;
      }
      if (keyEvent.key === 'MediaPlay') {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        setPaused(false);
        return;
      }
      if (keyEvent.key === 'MediaPause') {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        setPaused(true);
        return;
      }
      if (keyEvent.key === 'MediaRewind') {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        seek(latestRef.current.positionMs - 10_000);
        return;
      }
      if (keyEvent.key === 'MediaFastForward') {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        seek(latestRef.current.positionMs + 10_000);
        return;
      }
      showControls();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onBack, seek, setPaused, showControls]);

  const duration = event.durationMs || previewDuration;
  const progress = duration > 0 ? Math.min(duration, event.positionMs) : 0;
  const audio = media.kind === 'track';

  return (
    <section
      className={`player-page ${audio ? 'audio-player' : ''}`}
      onPointerMove={showControls}
      onPointerDown={showControls}
      onClick={(clickEvent: MouseEvent<HTMLElement>) => {
        if (clickEvent.target === clickEvent.currentTarget) showControls();
      }}
    >
      {backdrop && <div className="player-backdrop" style={{ backgroundImage: `url(${JSON.stringify(backdrop)})` }} />}
      <div ref={hostRef} className="player-host" />
      {mockMode && !audio && <div className="player-preview-field" aria-hidden="true" />}
      {audio && (
        <div className="audio-player-art">
          {cover ? <img src={cover} alt="" /> : <div className="audio-player-placeholder">♪</div>}
        </div>
      )}

      <div className={`player-chrome ${controlsVisible ? 'visible' : ''}`}>
        <div className="player-titlebar">
          <div>
            <strong>{media.title}</strong>
            {media.subtitle && <span>{media.subtitle}</span>}
          </div>
          {playbackNotice && <small>{playbackNotice}</small>}
        </div>

        <div className="player-scrubber-row">
          <span>{formatTime(progress)}</span>
          <input
            className="player-scrubber"
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={1_000}
            value={progress}
            aria-label="Playback position"
            data-tv-focusable="true"
            onChange={(changeEvent: ChangeEvent<HTMLInputElement>) => seek(Number(changeEvent.target.value))}
          />
          <span>{formatTime(duration)}</span>
        </div>

        <div className="player-button-row">
          <button type="button" data-tv-focusable="true" onClick={onBack} aria-label="Back">←</button>
          <button type="button" data-tv-focusable="true" onClick={() => seek(progress - 10_000)} aria-label="Back 10 seconds">↶ 10</button>
          <button className="player-primary-control" type="button" data-tv-focusable="true" onClick={() => setPaused(!event.paused)} aria-label={event.paused ? 'Play' : 'Pause'}>
            {event.paused ? '▶' : 'Ⅱ'}
          </button>
          <button type="button" data-tv-focusable="true" onClick={() => seek(progress + 10_000)} aria-label="Forward 10 seconds">10 ↷</button>
          <button type="button" data-tv-focusable="true" disabled title="Audio/subtitle selection will be wired with the playback API">⋯</button>
        </div>
      </div>
    </section>
  );
}

export function PlayerScreen(props: Props) {
  const details = useAsync(() => props.api.details(props.itemId), [props.api, props.itemId]);
  if (details.loading) return <Loading />;
  if (details.error) return <ErrorMessage error={details.error} />;
  if (!details.value) return null;
  if (!canPlay(details.value)) return <ErrorMessage error={new Error('This catalogue item is not directly playable.')} />;

  return <PlayerSession {...props} media={details.value} />;
}
