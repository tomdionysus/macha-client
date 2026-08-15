import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import type { MediaApi } from '../api/MediaApi';
import { ErrorMessage, Loading } from '../components/Status';
import { createClientLogger } from '../diagnostics/ClientLog';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useAsync } from '../hooks/useAsync';
import type { Platform } from '../platform/Platform';
import type {
  PlaybackPreferencesUpdate,
  PlaybackResolver,
  PlaybackSession,
  PlaybackStreamInfo,
  PlaybackUpdate,
} from '../playback/PlaybackResolver';
import { uiSettings } from '../settings';
import type { MediaSummary, PlaybackEvent, PlaybackMode, PlaybackProgress } from '../types';

interface Props {
  api: MediaApi;
  itemId: string;
  platform: Platform;
  playbackResolver: PlaybackResolver;
  startPositionMs: number;
  onProgress: (progress: PlaybackProgress) => void;
  onBack: () => void;
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatBitrate(bitrate: number): string {
  if (!bitrate) return '';
  return bitrate >= 1_000_000 ? `${(bitrate / 1_000_000).toFixed(1)} Mb/s` : `${Math.round(bitrate / 1000)} kb/s`;
}

type PlayerIconName = 'back' | 'rewind' | 'play' | 'pause' | 'forward' | 'options';

function PlayerIcon({ name }: { name: PlayerIconName }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': true,
  } as const;

  switch (name) {
    case 'back':
      return <svg {...common}><path d="M14.5 5 7.5 12l7 7M8 12h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'rewind':
      return <svg {...common}><path d="M10.5 6 4.5 12l6 6V6Zm8 0-6 6 6 6V6Z" fill="currentColor" /></svg>;
    case 'play':
      return <svg {...common}><path d="M8 5.5v13L18.5 12 8 5.5Z" fill="currentColor" /></svg>;
    case 'pause':
      return <svg {...common}><path d="M7.5 6h3v12h-3V6Zm6 0h3v12h-3V6Z" fill="currentColor" /></svg>;
    case 'forward':
      return <svg {...common}><path d="m13.5 6 6 6-6 6V6Zm-8 0 6 6-6 6V6Z" fill="currentColor" /></svg>;
    case 'options':
      return <svg {...common}><circle cx="6" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="18" cy="12" r="1.5" fill="currentColor" /></svg>;
  }
}

function canPlay(media: MediaSummary): boolean {
  return media.kind === 'movie' || media.kind === 'episode' || media.kind === 'track';
}

function shouldTrackProgress(media: MediaSummary): boolean {
  return media.kind === 'movie' || media.kind === 'episode';
}

function streamLabel(stream: PlaybackStreamInfo, fallback: string): string {
  const parts = [stream.language ? stream.language.toUpperCase() : fallback, stream.codec.toUpperCase()];
  if (stream.channels) parts.push(`${stream.channels}ch`);
  if (stream.forced) parts.push('forced');
  return parts.join(' · ');
}

function sourceVideoHeight(session: PlaybackSession): number | undefined {
  const selected = session.streams.find((stream) => stream.type === 'video' && stream.index === session.selected.videoStream);
  return selected?.height;
}

function qualityChoices(session: PlaybackSession): number[] {
  const sourceHeight = sourceVideoHeight(session);
  const standard = [2160, 1440, 1080, 720, 480, 360];
  if (!sourceHeight) return standard;
  const choices = standard.filter((height) => height < sourceHeight);
  if (!standard.includes(sourceHeight)) choices.unshift(sourceHeight);
  return [...new Set(choices)].sort((a, b) => b - a);
}

function sessionDescription(session?: PlaybackSession): string | undefined {
  if (!session) return undefined;
  const video = session.streams.find((stream) => stream.index === session.selected.videoStream);
  const audio = session.streams.find((stream) => stream.index === session.selected.audioStream);
  const parts = [session.mode.toUpperCase()];
  if (video) parts.push(video.codec.toUpperCase());
  if (audio) parts.push(audio.codec.toUpperCase());
  const bitrate = formatBitrate(session.sourceBitrate);
  if (bitrate) parts.push(bitrate);
  return parts.join(' · ');
}

function PlayerOptions({
  session,
  busy,
  qualityLimit,
  onQualityLimit,
  onApply,
}: {
  session: PlaybackSession;
  busy: boolean;
  qualityLimit: number | null;
  onQualityLimit: (height: number | null) => void;
  onApply: (update: PlaybackUpdate) => void;
}) {
  const selectedAudio = session.selected.audioStream;
  const selectedSubtitle = session.selected.subtitleStream;
  const qualities = qualityChoices(session);

  const mode = (value: PlaybackMode | 'auto') => onApply({ preferences: { mode: value } });
  const preferences = (update: PlaybackPreferencesUpdate) => onApply({ preferences: update });

  return (
    <div className="player-options" aria-label="Playback options">
      <div className="player-option-group">
        <span>Mode</span>
        <div>
          <button type="button" data-tv-focusable="true" disabled={busy} onClick={() => mode('auto')}>Auto</button>
          {session.options.modes.map((candidate) => (
            <button
              type="button"
              key={candidate}
              data-tv-focusable="true"
              className={session.mode === candidate ? 'selected' : undefined}
              disabled={busy}
              onClick={() => mode(candidate)}
            >
              {candidate}
            </button>
          ))}
        </div>
      </div>

      {session.options.canChangeQuality && qualities.length > 0 && (
        <div className="player-option-group">
          <span>Quality</span>
          <div>
            <button
              type="button"
              data-tv-focusable="true"
              className={qualityLimit === null ? 'selected' : undefined}
              disabled={busy}
              onClick={() => { onQualityLimit(null); preferences({ maxHeight: null, maxBitrate: null }); }}
            >
              Original
            </button>
            {qualities.map((height) => (
              <button
                type="button"
                key={height}
                data-tv-focusable="true"
                className={qualityLimit === height ? 'selected' : undefined}
                disabled={busy}
                onClick={() => { onQualityLimit(height); preferences({ maxHeight: height }); }}
              >
                {height}p
              </button>
            ))}
          </div>
        </div>
      )}

      {session.options.audioStreams.length > 1 && (
        <div className="player-option-group">
          <span>Audio</span>
          <div>
            {session.options.audioStreams.map((stream) => (
              <button
                type="button"
                key={stream.index}
                data-tv-focusable="true"
                className={selectedAudio === stream.index ? 'selected' : undefined}
                disabled={busy}
                onClick={() => preferences({ audioStream: stream.index, audioLanguage: '' })}
              >
                {streamLabel(stream, `Audio ${stream.index}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {session.options.subtitleStreams.length > 0 && (
        <div className="player-option-group">
          <span>Subtitles</span>
          <div>
            <button
              type="button"
              data-tv-focusable="true"
              className={selectedSubtitle < 0 ? 'selected' : undefined}
              disabled={busy}
              onClick={() => preferences({ subtitleStream: null, subtitleLanguage: '' })}
            >
              Off
            </button>
            {session.options.subtitleStreams.map((stream) => (
              <button
                type="button"
                key={stream.index}
                data-tv-focusable="true"
                className={selectedSubtitle === stream.index ? 'selected' : undefined}
                disabled={busy}
                onClick={() => preferences({ subtitleStream: stream.index, subtitleLanguage: '' })}
              >
                {streamLabel(stream, `Subtitle ${stream.index}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {session.options.canSwitchMedia && session.options.mediaIds.length > 1 && (
        <div className="player-option-group">
          <span>Source</span>
          <div>
            {session.options.mediaIds.map((mediaId, index) => (
              <button
                type="button"
                key={mediaId}
                data-tv-focusable="true"
                className={session.mediaId === mediaId ? 'selected' : undefined}
                disabled={busy}
                title={mediaId}
                onClick={() => onApply({ mediaId })}
              >
                Source {index + 1}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerSession({ api, media, platform, playbackResolver, startPositionMs, onProgress, onBack }: Omit<Props, 'itemId'> & { media: MediaSummary }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const player = useMemo(() => platform.createPlayer(), [platform]);
  const log = useMemo(() => createClientLogger('playback.screen', { mediaId: media.id }), [media.id]);
  const initialEvent = useMemo<PlaybackEvent>(() => ({
    positionMs: Math.max(0, startPositionMs),
    durationMs: media.durationMs ?? 0,
    paused: true,
    ended: false,
  }), [media.durationMs, startPositionMs]);
  const latestRef = useRef(initialEvent);
  const sessionRef = useRef<PlaybackSession>();
  const streamOffsetRef = useRef(0);
  const reloadingRef = useRef(false);
  const lastReportRef = useRef(0);
  const hideTimerRef = useRef<number>();
  const mountedRef = useRef(true);
  const [event, setEvent] = useState(initialEvent);
  const [session, setSession] = useState<PlaybackSession>();
  const [starting, setStarting] = useState(true);
  const [fatalError, setFatalError] = useState<Error>();
  const [playbackNotice, setPlaybackNotice] = useState<string>();
  const [controlsVisible, setControlsVisible] = useState(true);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [qualityLimit, setQualityLimit] = useState<number | null>(null);
  const [scrubValue, setScrubValue] = useState<number>();
  const backdrop = useArtworkUrl(api, media.artwork?.backdrop ?? media.artwork?.thumbnail ?? media.artwork?.poster);
  const cover = useArtworkUrl(api, media.kind === 'track' ? media.artwork?.poster ?? media.artwork?.thumbnail : undefined);

  const publish = useCallback((next: PlaybackEvent) => {
    const previous = latestRef.current;
    latestRef.current = next;
    if (previous.paused !== next.paused || previous.ended !== next.ended) {
      log.debug('playback-state', { previous, next, streamOffsetMs: streamOffsetRef.current });
    }
    setEvent(next);
    if (!shouldTrackProgress(media)) return;
    const now = Date.now();
    if (next.ended || now - lastReportRef.current >= 10_000) {
      lastReportRef.current = now;
      onProgress({
        mediaId: media.id,
        positionMs: next.positionMs,
        durationMs: next.durationMs,
        updatedAt: now,
        media,
      });
    }
  }, [log, media, onProgress]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    if (!latestRef.current.paused && !optionsVisible && !controlBusy) {
      hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), uiSettings.playerControlsHideDelayMs);
    }
  }, [controlBusy, optionsVisible]);

  const loadSession = useCallback(async (next: PlaybackSession, absolutePositionMs: number) => {
    const bounded = Math.max(0, Math.min(next.durationMs || Number.MAX_SAFE_INTEGER, absolutePositionMs));
    const localPosition = next.mode === 'direct' ? bounded : 0;
    streamOffsetRef.current = next.mode === 'direct' ? 0 : bounded;
    sessionRef.current = next;
    setSession(next);
    reloadingRef.current = true;
    const startedAt = performance.now();
    log.info('session-load-begin', {
      sessionId: next.sessionId,
      mode: next.mode,
      mediaId: next.mediaId,
      absolutePositionMs,
      boundedPositionMs: bounded,
      localPlayerPositionMs: localPosition,
      streamOffsetMs: streamOffsetRef.current,
      source: next.source,
    });
    try {
      const started = await player.play(next.source, localPosition);
      log.info('session-load-ready', {
        sessionId: next.sessionId,
        mode: next.mode,
        started,
        elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
        absolutePositionMs: bounded,
      });
      publish({
        positionMs: bounded,
        durationMs: next.durationMs,
        paused: !started,
        ended: false,
      });
    } catch (error) {
      log.error('session-load-failed', {
        sessionId: next.sessionId,
        mode: next.mode,
        elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
        error,
      });
      throw error;
    } finally {
      reloadingRef.current = false;
    }
  }, [log, player, publish]);

  useEffect(() => {
    mountedRef.current = true;
    const host = hostRef.current;
    if (!host) return;
    log.info('player-mount', {
      itemId: media.id,
      mediaKind: media.kind,
      startPositionMs,
      catalogueDurationMs: media.durationMs,
      platform: platform.name,
    });
    player.attach(host);
    const unsubscribe = player.subscribe((next) => {
      if (!mountedRef.current || reloadingRef.current) return;
      const activeSession = sessionRef.current;
      const durationMs = activeSession?.durationMs || next.durationMs;
      publish({
        ...next,
        positionMs: next.positionMs + streamOffsetRef.current,
        durationMs,
      });
    });

    void (async () => {
      let resolved: PlaybackSession | undefined;
      try {
        const capabilitiesStartedAt = performance.now();
        const capabilities = await platform.capabilities();
        log.debug('capabilities-ready', { elapsedMs: Math.round((performance.now() - capabilitiesStartedAt) * 10) / 10, capabilities });
        const resolveStartedAt = performance.now();
        resolved = await playbackResolver.resolve(media, capabilities);
        log.info('session-resolved', {
          elapsedMs: Math.round((performance.now() - resolveStartedAt) * 10) / 10,
          sessionId: resolved.sessionId,
          mode: resolved.mode,
          durationMs: resolved.durationMs,
          startPositionMs,
        });
        if (!mountedRef.current) {
          await playbackResolver.stop(resolved.sessionId);
          return;
        }
        let absolutePosition = Math.min(startPositionMs, resolved.durationMs || startPositionMs);
        if (absolutePosition > 0 && resolved.mode !== 'direct' && resolved.options.canSeek) {
          const initialSeekStartedAt = performance.now();
          log.info('initial-server-seek-begin', { sessionId: resolved.sessionId, positionMs: absolutePosition, mode: resolved.mode });
          resolved = await playbackResolver.update(resolved.sessionId, { seekMs: absolutePosition });
          log.info('initial-server-seek-complete', {
            sessionId: resolved.sessionId,
            positionMs: absolutePosition,
            mode: resolved.mode,
            elapsedMs: Math.round((performance.now() - initialSeekStartedAt) * 10) / 10,
          });
          if (!mountedRef.current) {
            await playbackResolver.stop(resolved.sessionId).catch(() => undefined);
            return;
          }
        }
        await loadSession(resolved, absolutePosition);
      } catch (error) {
        log.error('player-startup-failed', error);
        if (!mountedRef.current) return;
        setFatalError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        if (mountedRef.current) setStarting(false);
      }
    })();

    return () => {
      log.info('player-unmount', { sessionId: sessionRef.current?.sessionId, latest: latestRef.current });
      mountedRef.current = false;
      unsubscribe();
      player.detach();
      const activeSession = sessionRef.current;
      if (activeSession) void playbackResolver.stop(activeSession.sessionId).catch(() => undefined);
    };
  }, [loadSession, log, media, platform, playbackResolver, player, publish, startPositionMs]);

  useEffect(() => {
    showControls();
    return () => {
      if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    };
  }, [showControls]);

  useEffect(() => () => {
    if (!shouldTrackProgress(media)) return;
    const latest = latestRef.current;
    if (!latest.durationMs) return;
    onProgress({
      mediaId: media.id,
      positionMs: latest.positionMs,
      durationMs: latest.durationMs,
      updatedAt: Date.now(),
      media,
    });
  }, [media, onProgress]);

  const setPaused = useCallback((paused: boolean) => {
    if (!sessionRef.current) {
      log.warn('pause-toggle-without-session', { paused });
      return;
    }
    log.info(paused ? 'pause-ui-request' : 'play-ui-request', { sessionId: sessionRef.current.sessionId, positionMs: latestRef.current.positionMs });
    if (paused) player.pause();
    else player.resume();
    publish({ ...latestRef.current, paused });
    if (paused) {
      setControlsVisible(true);
      if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    } else {
      showControls();
    }
  }, [log, player, publish, showControls]);

  const seek = useCallback(async (positionMs: number) => {
    const activeSession = sessionRef.current;
    if (!activeSession || controlBusy || !activeSession.options.canSeek) return;
    const bounded = Math.max(0, Math.min(activeSession.durationMs, positionMs));
    log.info('seek-ui-request', {
      sessionId: activeSession.sessionId,
      mode: activeSession.mode,
      requestedPositionMs: positionMs,
      boundedPositionMs: bounded,
      currentPositionMs: latestRef.current.positionMs,
    });
    setScrubValue(undefined);
    showControls();
    if (activeSession.mode === 'direct') {
      const directSeekStartedAt = performance.now();
      player.seek(bounded);
      log.info('seek-direct-dispatched', { elapsedMs: Math.round((performance.now() - directSeekStartedAt) * 10) / 10, positionMs: bounded });
      publish({ ...latestRef.current, positionMs: bounded, ended: false });
      return;
    }

    setControlBusy(true);
    setPlaybackNotice('Seeking…');
    const seekStartedAt = performance.now();
    try {
      const next = await playbackResolver.update(activeSession.sessionId, { seekMs: bounded });
      log.info('seek-server-updated', {
        sessionId: next.sessionId,
        mode: next.mode,
        positionMs: bounded,
        elapsedMs: Math.round((performance.now() - seekStartedAt) * 10) / 10,
      });
      if (!mountedRef.current) {
        await playbackResolver.stop(next.sessionId).catch(() => undefined);
        return;
      }
      await loadSession(next, bounded);
      log.info('seek-complete', {
        sessionId: next.sessionId,
        mode: next.mode,
        positionMs: bounded,
        elapsedMs: Math.round((performance.now() - seekStartedAt) * 10) / 10,
      });
      setPlaybackNotice(undefined);
    } catch (error) {
      log.error('seek-failed', {
        sessionId: activeSession.sessionId,
        mode: activeSession.mode,
        positionMs: bounded,
        elapsedMs: Math.round((performance.now() - seekStartedAt) * 10) / 10,
        error,
      });
      if (mountedRef.current) setPlaybackNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (mountedRef.current) setControlBusy(false);
    }
  }, [controlBusy, loadSession, log, playbackResolver, player, publish, showControls]);

  const reconfigure = useCallback(async (update: PlaybackUpdate) => {
    const activeSession = sessionRef.current;
    if (!activeSession || controlBusy) return;
    const position = latestRef.current.positionMs;
    const updateStartedAt = performance.now();
    log.info('stream-update-ui-request', { sessionId: activeSession.sessionId, positionMs: position, update });
    setControlBusy(true);
    setPlaybackNotice('Updating stream…');
    try {
      const next = await playbackResolver.update(activeSession.sessionId, {
        ...update,
        seekMs: activeSession.options.canSeek ? position : update.seekMs,
      });
      log.info('stream-update-server-complete', {
        sessionId: next.sessionId,
        mode: next.mode,
        positionMs: position,
        elapsedMs: Math.round((performance.now() - updateStartedAt) * 10) / 10,
      });
      if (!mountedRef.current) {
        await playbackResolver.stop(next.sessionId).catch(() => undefined);
        return;
      }
      await loadSession(next, position);
      log.info('stream-update-complete', {
        sessionId: next.sessionId,
        mode: next.mode,
        positionMs: position,
        elapsedMs: Math.round((performance.now() - updateStartedAt) * 10) / 10,
      });
      setPlaybackNotice(undefined);
    } catch (error) {
      log.error('stream-update-failed', {
        sessionId: activeSession.sessionId,
        positionMs: position,
        elapsedMs: Math.round((performance.now() - updateStartedAt) * 10) / 10,
        update,
        error,
      });
      if (mountedRef.current) setPlaybackNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (mountedRef.current) setControlBusy(false);
    }
  }, [controlBusy, loadSession, log, playbackResolver]);

  useEffect(() => {
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape' || keyEvent.key === 'Backspace') {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        if (optionsVisible) setOptionsVisible(false);
        else onBack();
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
        void seek(latestRef.current.positionMs - 10_000);
        return;
      }
      if (keyEvent.key === 'MediaFastForward') {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        void seek(latestRef.current.positionMs + 10_000);
        return;
      }
      showControls();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onBack, optionsVisible, seek, setPaused, showControls]);

  const duration = session?.durationMs || event.durationMs || 1;
  const displayedProgress = scrubValue ?? Math.min(duration, event.positionMs);
  const audio = media.kind === 'track';

  if (fatalError) {
    return <section className="player-page"><ErrorMessage error={fatalError} /></section>;
  }

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
      {audio && (
        <div className="audio-player-art">
          {cover ? <img src={cover} alt="" /> : <div className="audio-player-placeholder">♪</div>}
        </div>
      )}
      {starting && <Loading />}

      <div className={`player-chrome ${controlsVisible ? 'visible' : ''}`}>
        <div className="player-titlebar">
          <div>
            <strong>{media.title}</strong>
            {media.subtitle && <span>{media.subtitle}</span>}
          </div>
          <small>{playbackNotice ?? sessionDescription(session)}</small>
        </div>

        {optionsVisible && session && (
          <PlayerOptions
            session={session}
            busy={controlBusy}
            qualityLimit={qualityLimit}
            onQualityLimit={setQualityLimit}
            onApply={(update) => void reconfigure(update)}
          />
        )}

        <div className="player-scrubber-row">
          <span>{formatTime(displayedProgress)}</span>
          <input
            className="player-scrubber"
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={1_000}
            value={displayedProgress}
            aria-label="Playback position"
            data-tv-focusable="true"
            disabled={!session?.options.canSeek || controlBusy}
            onChange={(changeEvent: ChangeEvent<HTMLInputElement>) => setScrubValue(Number(changeEvent.target.value))}
            onPointerUp={() => { if (scrubValue !== undefined) void seek(scrubValue); }}
            onKeyUp={(keyEvent) => {
              if (scrubValue !== undefined && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(keyEvent.key)) void seek(scrubValue);
            }}
            onBlur={() => { if (scrubValue !== undefined) void seek(scrubValue); }}
          />
          <span>{formatTime(duration)}</span>
        </div>

        <div className="player-button-row">
          <button type="button" data-tv-focusable="true" onClick={onBack} aria-label="Back"><PlayerIcon name="back" /></button>
          <button type="button" data-tv-focusable="true" disabled={!session?.options.canSeek || controlBusy} onClick={() => void seek(displayedProgress - 10_000)} aria-label="Seek backward"><PlayerIcon name="rewind" /></button>
          <button type="button" data-tv-focusable="true" disabled={!session || controlBusy} onClick={() => setPaused(!event.paused)} aria-label={event.paused ? 'Play' : 'Pause'}>
            <PlayerIcon name={event.paused ? 'play' : 'pause'} />
          </button>
          <button type="button" data-tv-focusable="true" disabled={!session?.options.canSeek || controlBusy} onClick={() => void seek(displayedProgress + 10_000)} aria-label="Seek forward"><PlayerIcon name="forward" /></button>
          <button
            type="button"
            data-tv-focusable="true"
            disabled={!session || controlBusy}
            className={optionsVisible ? 'selected' : undefined}
            onClick={() => { setOptionsVisible((visible) => !visible); setControlsVisible(true); }}
            aria-label="Playback options"
          >
            <PlayerIcon name="options" />
          </button>
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
