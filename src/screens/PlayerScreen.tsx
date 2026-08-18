import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import type { MediaApi } from '../api/MediaApi';
import { PlayIcon, RestartIcon } from '../components/PlaybackIcons';
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
import { describePlaybackSession } from '../playback/PlaybackStatus';
import type { MediaSummary, PlaybackEvent, PlaybackMode, PlaybackProgress } from '../types';

interface Props {
  api: MediaApi;
  itemId: string;
  media?: MediaSummary;
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

type PlayerIconName = 'back' | 'rewind' | 'pause' | 'forward' | 'options' | 'fullscreen' | 'fullscreen-exit';

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
    case 'pause':
      return <svg {...common}><path d="M7.5 6h3v12h-3V6Zm6 0h3v12h-3V6Z" fill="currentColor" /></svg>;
    case 'forward':
      return <svg {...common}><path d="m13.5 6 6 6-6 6V6Zm-8 0 6 6-6 6V6Z" fill="currentColor" /></svg>;
    case 'options':
      return <svg {...common}><circle cx="6" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="18" cy="12" r="1.5" fill="currentColor" /></svg>;
    case 'fullscreen':
      return <svg {...common}><path d="M8.5 4.5h-4v4M15.5 4.5h4v4M8.5 19.5h-4v-4M15.5 19.5h4v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'fullscreen-exit':
      return <svg {...common}><path d="M9 4.5v4.5H4.5M15 4.5V9h4.5M9 19.5V15H4.5M15 19.5V15h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
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

function qualityChoices(session: PlaybackSession): number[] {
  return session.options.qualityHeights;
}

function PlayerOptions({
  session,
  busy,
  onApply,
}: {
  session: PlaybackSession;
  busy: boolean;
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
          <button
            type="button"
            data-tv-focusable="true"
            className={session.preferences.mode === 'auto' ? 'selected' : undefined}
            disabled={busy}
            onClick={() => mode('auto')}
          >
            Auto
          </button>
          {session.options.modes.map((candidate) => (
            <button
              type="button"
              key={candidate}
              data-tv-focusable="true"
              className={session.preferences.mode === candidate ? 'selected' : undefined}
              disabled={busy}
              onClick={() => mode(candidate)}
            >
              {candidate === 'direct' ? 'Direct' : candidate === 'remux' ? 'Remux' : 'Transcode'}
            </button>
          ))}
        </div>
      </div>

      {session.options.canChangeQuality && (
        <div className="player-option-group">
          <span>Quality</span>
          <div>
            <button
              type="button"
              data-tv-focusable="true"
              className={session.preferences.maxHeight === null && session.preferences.maxBitrate === null ? 'selected' : undefined}
              disabled={busy}
              onClick={() => preferences({ maxHeight: null, maxBitrate: null })}
            >
              Original
            </button>
            {qualities.map((height) => (
              <button
                type="button"
                key={height}
                data-tv-focusable="true"
                className={session.preferences.maxHeight === height ? 'selected' : undefined}
                disabled={busy}
                onClick={() => preferences({ maxHeight: height })}
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

function PlayerSession({ api, media, platform, playbackResolver, startPositionMs, onProgress, onBack }: Omit<Props, 'itemId' | 'media'> & { media: MediaSummary }) {
  const pageRef = useRef<HTMLElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const player = useMemo(() => platform.createPlayer(), [platform]);
  const log = useMemo(() => createClientLogger('playback.screen', { mediaId: media.id }), [media.id]);
  const initialStartPositionMs = useRef(Math.max(0, startPositionMs)).current;
  const initialEvent = useMemo<PlaybackEvent>(() => ({
    positionMs: initialStartPositionMs,
    durationMs: media.durationMs ?? 0,
    paused: true,
    ended: false,
  }), [initialStartPositionMs, media.durationMs]);
  const latestRef = useRef(initialEvent);
  const sessionRef = useRef<PlaybackSession>();
  const streamOffsetRef = useRef(0);
  const reloadingRef = useRef(false);
  const lastReportRef = useRef(0);
  const hideTimerRef = useRef<number>();
  const scrubValueRef = useRef<number>();
  const committedSeekRef = useRef<number>();
  const mountedRef = useRef(true);
  const [event, setEvent] = useState(initialEvent);
  const [session, setSession] = useState<PlaybackSession>();
  const [starting, setStarting] = useState(true);
  const [fatalError, setFatalError] = useState<Error>();
  const [playbackNotice, setPlaybackNotice] = useState<string>();
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [seekInFlight, setSeekInFlight] = useState(false);
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

  const setScrubPosition = useCallback((positionMs: number | undefined) => {
    scrubValueRef.current = positionMs;
    setScrubValue(positionMs);
  }, []);

  const clearCommittedSeek = useCallback(() => {
    committedSeekRef.current = undefined;
    setScrubPosition(undefined);
  }, [setScrubPosition]);

  const loadSession = useCallback(async (next: PlaybackSession, absolutePositionMs: number, resumeAfterLoad = true) => {
    const bounded = Math.max(0, Math.min(next.durationMs || Number.MAX_SAFE_INTEGER, absolutePositionMs));
    const serverSeek = Math.max(0, Math.min(next.durationMs || Number.MAX_SAFE_INTEGER, next.seekMs));
    const effectivePosition = next.mode === 'direct' ? bounded : serverSeek;
    const localPosition = next.mode === 'direct' ? bounded : 0;
    streamOffsetRef.current = next.mode === 'direct' ? 0 : serverSeek;
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
      serverSeekMs: next.seekMs,
      effectivePositionMs: effectivePosition,
      localPlayerPositionMs: localPosition,
      streamOffsetMs: streamOffsetRef.current,
      source: next.source,
    });
    try {
      const started = await player.play(next.source, localPosition);
      if (!resumeAfterLoad && started) player.pause();
      log.info('session-load-ready', {
        sessionId: next.sessionId,
        mode: next.mode,
        started,
        resumeAfterLoad,
        elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
        absolutePositionMs: effectivePosition,
      });
      publish({
        positionMs: effectivePosition,
        durationMs: next.durationMs,
        paused: resumeAfterLoad ? !started : true,
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
      startPositionMs: initialStartPositionMs,
      catalogueDurationMs: media.durationMs,
      platform: platform.name,
    });
    player.attach(host);
    const unsubscribe = player.subscribe((next) => {
      if (!mountedRef.current || reloadingRef.current) return;
      const activeSession = sessionRef.current;
      const durationMs = activeSession?.durationMs || next.durationMs;
      const absolutePositionMs = next.positionMs + streamOffsetRef.current;
      const committedSeek = committedSeekRef.current;
      if (committedSeek !== undefined) {
        // A browser may emit pause/timeupdate events from the old position after
        // a range interaction. Keep the user's committed seek authoritative
        // until the player itself reaches the new position.
        if (Math.abs(absolutePositionMs - committedSeek) > 1_500) return;
        clearCommittedSeek();
      }
      publish({
        ...next,
        positionMs: absolutePositionMs,
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
          startPositionMs: initialStartPositionMs,
        });
        if (!mountedRef.current) {
          await playbackResolver.stop(resolved.sessionId);
          return;
        }
        let absolutePosition = Math.min(initialStartPositionMs, resolved.durationMs || initialStartPositionMs);
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
  }, [clearCommittedSeek, initialStartPositionMs, loadSession, log, media, platform, playbackResolver, player, publish]);

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
    if (!activeSession || controlBusy || !activeSession.options.canSeek) return false;
    const bounded = Math.max(0, Math.min(activeSession.durationMs, positionMs));
    const previous = latestRef.current;
    const resumeAfterSeek = !previous.paused;
    log.info('seek-ui-request', {
      sessionId: activeSession.sessionId,
      mode: activeSession.mode,
      requestedPositionMs: positionMs,
      boundedPositionMs: bounded,
      currentPositionMs: previous.positionMs,
      resumeAfterSeek,
    });

    committedSeekRef.current = bounded;
    setScrubPosition(bounded);
    setControlsVisible(true);
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);

    if (activeSession.mode === 'direct') {
      // Freeze the current picture immediately, move the media element, then
      // resume only if playback was running before the seek. The committed
      // scrub value prevents stale media events snapping the bar backwards.
      player.pause();
      publish({ ...previous, positionMs: bounded, paused: true, ended: false });
      const directSeekStartedAt = performance.now();
      player.seek(bounded);
      if (resumeAfterSeek) player.resume();
      log.info('seek-direct-dispatched', {
        elapsedMs: Math.round((performance.now() - directSeekStartedAt) * 10) / 10,
        positionMs: bounded,
        resumeAfterSeek,
      });
      return true;
    }

    // Server-backed seek generations can take long enough to be perceptible.
    // Pause the old stream immediately but delay the spinner so a fast restart
    // looks like one continuous interaction rather than a flash of loading UI.
    reloadingRef.current = true;
    player.pause();
    publish({ ...previous, positionMs: bounded, paused: true, ended: false });
    setControlBusy(true);
    setSeekInFlight(true);
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
        return false;
      }
      await loadSession(next, bounded, resumeAfterSeek);
      clearCommittedSeek();
      log.info('seek-complete', {
        sessionId: next.sessionId,
        mode: next.mode,
        positionMs: bounded,
        elapsedMs: Math.round((performance.now() - seekStartedAt) * 10) / 10,
        resumeAfterSeek,
      });
      setPlaybackNotice(undefined);
      return true;
    } catch (error) {
      log.error('seek-failed', {
        sessionId: activeSession.sessionId,
        mode: activeSession.mode,
        positionMs: bounded,
        elapsedMs: Math.round((performance.now() - seekStartedAt) * 10) / 10,
        error,
      });
      reloadingRef.current = false;
      clearCommittedSeek();
      publish(previous);
      if (resumeAfterSeek) player.resume();
      if (mountedRef.current) setPlaybackNotice(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      reloadingRef.current = false;
      if (mountedRef.current) {
        setSeekInFlight(false);
        setControlBusy(false);
      }
    }
  }, [clearCommittedSeek, controlBusy, loadSession, log, playbackResolver, player, publish, setScrubPosition]);

  const playFromStart = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession || controlBusy || !activeSession.options.canSeek) return;
    log.info('restart-ui-request', {
      sessionId: activeSession.sessionId,
      mode: activeSession.mode,
      currentPositionMs: latestRef.current.positionMs,
    });
    const restarted = await seek(0);
    if (!restarted || !mountedRef.current) return;
    setPaused(false);
  }, [controlBusy, log, seek, setPaused]);

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
    const onFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === pageRef.current);
      showControls();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [showControls]);

  const toggleFullscreen = useCallback(async () => {
    if (platform.name !== 'web' || !document.fullscreenEnabled || !pageRef.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await pageRef.current.requestFullscreen();
    } catch (error) {
      log.warn('fullscreen-failed', { error });
    }
  }, [log, platform.name]);

  useEffect(() => {
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape' && document.fullscreenElement) return;
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
  const streamStatus = describePlaybackSession(session);
  const mediaSubtitle = media.kind === 'episode'
    ? `${media.playbackContext!.series.title} ${media.subtitle ?? ''}`.trim()
    : media.subtitle;

  if (fatalError) {
    return <section className="player-page"><ErrorMessage error={fatalError} /></section>;
  }

  return (
    <section
      ref={pageRef}
      className={`player-page ${audio ? 'audio-player' : ''} ${fullscreen && !controlsVisible ? 'cursor-hidden' : ''}`}
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
      {seekInFlight && <Loading delayMs={uiSettings.playerSeekSpinnerDelayMs} />}

      <div className={`player-chrome ${controlsVisible ? 'visible' : ''}`}>
        <div className="player-titlebar">
          <div className="player-title-copy">
            <strong>{media.title}</strong>
            {mediaSubtitle && <span>{mediaSubtitle}</span>}
          </div>
          <div className="player-stream-status" aria-live="polite">
            {playbackNotice ? (
              <small>{playbackNotice}</small>
            ) : (
              <>
                {streamStatus?.video && <small>{streamStatus.video}</small>}
                {streamStatus?.audio && <small>{streamStatus.audio}</small>}
              </>
            )}
          </div>
        </div>

        {optionsVisible && session && (
          <PlayerOptions
            session={session}
            busy={controlBusy}
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
            disabled={!session?.options.canSeek}
            aria-busy={controlBusy || undefined}
            onChange={(changeEvent: ChangeEvent<HTMLInputElement>) => {
              if (!controlBusy) setScrubPosition(Number(changeEvent.target.value));
            }}
            onPointerUp={() => {
              const position = scrubValueRef.current;
              if (!controlBusy && position !== undefined) void seek(position);
            }}
            onKeyUp={(keyEvent) => {
              const position = scrubValueRef.current;
              if (!controlBusy && position !== undefined && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(keyEvent.key)) void seek(position);
            }}
            onBlur={() => {
              const position = scrubValueRef.current;
              if (!controlBusy && position !== undefined) void seek(position);
            }}
          />
          <span>{formatTime(duration)}</span>
        </div>

        <div className="player-button-row">
          <button type="button" data-tv-focusable="true" onClick={onBack} aria-label="Back"><PlayerIcon name="back" /></button>
          <button
            type="button"
            data-tv-focusable="true"
            disabled={!session?.options.canSeek || controlBusy}
            onClick={() => void playFromStart()}
            aria-label="Play from start"
            title="Play from start"
          >
            <RestartIcon />
          </button>
          <button type="button" data-tv-focusable="true" disabled={!session?.options.canSeek || controlBusy} onClick={() => void seek(displayedProgress - 10_000)} aria-label="Seek backward"><PlayerIcon name="rewind" /></button>
          <button type="button" data-tv-focusable="true" disabled={!session || controlBusy} onClick={() => setPaused(!event.paused)} aria-label={event.paused ? 'Play' : 'Pause'}>
            {event.paused ? <PlayIcon /> : <PlayerIcon name="pause" />}
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
          {platform.name === 'web' && document.fullscreenEnabled && (
            <button
              type="button"
              data-tv-focusable="true"
              onClick={() => void toggleFullscreen()}
              aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              <PlayerIcon name={fullscreen ? 'fullscreen-exit' : 'fullscreen'} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export function PlayerScreen(props: Props) {
  const details = useAsync(
    () => props.media?.id === props.itemId ? Promise.resolve(props.media) : props.api.details(props.itemId),
    [props.api, props.itemId, props.media],
  );
  if (details.loading) return <Loading />;
  if (details.error) return <ErrorMessage error={details.error} />;
  if (!details.value) return null;
  if (!canPlay(details.value)) return <ErrorMessage error={new Error('This catalogue item is not directly playable.')} />;
  if (details.value.kind === 'episode' && !details.value.playbackContext) {
    return <ErrorMessage error={new Error('Episode playback hierarchy context is missing.')} />;
  }

  return (
    <PlayerSession
      key={details.value.id}
      {...props}
      media={details.value}
    />
  );
}
