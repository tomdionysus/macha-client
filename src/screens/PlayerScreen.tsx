import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react';
import type { MediaApi } from '../api/MediaApi';
import { PlayIcon, RestartIcon } from '../components/PlaybackIcons';
import { Loading } from '../components/Status';
import { createClientLogger } from '../diagnostics/ClientLog';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { requestTvDefaultFocus } from '../hooks/useTvNavigation';
import type { Platform } from '../platform/Platform';
import type { PlaybackUpdate } from '../playback/PlaybackResolver';
import { isSubtitleOnlyPlaybackUpdate, type PlaybackCoordinatorSnapshot } from '../playback/PlaybackCoordinator';
import { PlaybackRuntime, type PlaybackRuntimeRequest, type PlaybackRuntimeSnapshot } from '../playback/PlaybackRuntime';
import { uiSettings } from '../settings';
import { describePlaybackSession } from '../playback/PlaybackStatus';
import { bufferedTimelineSegments } from '../playback/BufferedTimeline';
import type { MediaSummary, PlaybackEvent, PlaybackProgress } from '../types';
import { PlayerOptions } from './player/PlayerOptions';

interface Props {
  api: MediaApi;
  request: PlaybackRuntimeRequest;
  platform: Platform;
  runtime: PlaybackRuntime;
  presentation: 'full' | 'mini';
  onProgress: (progress: PlaybackProgress) => void;
  onPosition: (media: MediaSummary, positionMs: number, durationMs: number) => void;
  onMinimize: () => void;
  onExpand: () => void;
  onStop: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onEnded: () => void;
  canPrevious: boolean;
  canNext: boolean;
  queuePosition?: { index: number; total: number };
  volume: number;
  onVolumeChange: (volume: number) => void;
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

type PlayerIconName = 'back' | 'previous' | 'rewind' | 'pause' | 'forward' | 'next' | 'options' | 'expand' | 'close' | 'fullscreen' | 'fullscreen-exit' | 'volume' | 'mute';

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
    case 'previous':
      return <svg {...common}><path d="M6 5h2v14H6V5Zm12 1-8 6 8 6V6Z" fill="currentColor" /></svg>;
    case 'rewind':
      return <svg {...common}><path d="M10.5 6 4.5 12l6 6V6Zm8 0-6 6 6 6V6Z" fill="currentColor" /></svg>;
    case 'pause':
      return <svg {...common}><path d="M7.5 6h3v12h-3V6Zm6 0h3v12h-3V6Z" fill="currentColor" /></svg>;
    case 'forward':
      return <svg {...common}><path d="m13.5 6 6 6-6 6V6Zm-8 0 6 6-6 6V6Z" fill="currentColor" /></svg>;
    case 'next':
      return <svg {...common}><path d="M16 5h2v14h-2V5ZM6 6l8 6-8 6V6Z" fill="currentColor" /></svg>;
    case 'options':
      return <svg {...common}><circle cx="6" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="18" cy="12" r="1.5" fill="currentColor" /></svg>;
    case 'expand':
      return <svg {...common}><path d="M8.5 4.5h-4v4M15.5 4.5h4v4M8.5 19.5h-4v-4M15.5 19.5h4v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'close':
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
    case 'fullscreen':
      return <svg {...common}><path d="M8.5 4.5h-4v4M15.5 4.5h4v4M8.5 19.5h-4v-4M15.5 19.5h4v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'fullscreen-exit':
      return <svg {...common}><path d="M9 4.5v4.5H4.5M15 4.5V9h4.5M9 19.5V15H4.5M15 19.5V15h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'volume':
      return <svg {...common}><path d="M4 10v4h3l4 3V7l-4 3H4Z" fill="currentColor" /><path d="M14 9.2a4 4 0 0 1 0 5.6M16.6 6.8a7.3 7.3 0 0 1 0 10.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
    case 'mute':
      return <svg {...common}><path d="M4 10v4h3l4 3V7l-4 3H4Z" fill="currentColor" /><path d="m15 9 5 6M20 9l-5 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
  }
}

function VolumeControl({ volume, onChange, compact = false }: { volume: number; onChange: (volume: number) => void; compact?: boolean }) {
  const lastAudibleRef = useRef(volume > 0 ? volume : 1);
  useEffect(() => {
    if (volume > 0) lastAudibleRef.current = volume;
  }, [volume]);

  return (
    <div className={`player-volume-control${compact ? ' compact' : ''}`}>
      <button
        type="button"
        data-tv-focusable="true"
        aria-label={volume > 0 ? 'Mute' : 'Unmute'}
        title={volume > 0 ? 'Mute' : 'Unmute'}
        onClick={() => onChange(volume > 0 ? 0 : lastAudibleRef.current)}
      >
        <PlayerIcon name={volume > 0 ? 'volume' : 'mute'} />
      </button>
      <input
        className="player-volume-slider"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        data-tv-focusable="true"
        aria-label="Volume"
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function shouldTrackProgress(media: MediaSummary): boolean {
  return media.kind === 'movie' || media.kind === 'episode';
}

export function webSeekDeltaForKey(key: string): number | undefined {
  if (key === 'ArrowLeft') return -10_000;
  if (key === 'ArrowRight') return 10_000;
  return undefined;
}

export function samsungSeekDeltaForKey(key: string, keyCode: number, controlsVisible: boolean): number | undefined {
  // When the control bar is visible left/right remain spatial-navigation keys.
  // With playback chrome hidden they are transport shortcuts, matching TV-player
  // convention without making the control row impossible to navigate.
  if (controlsVisible) return undefined;
  if (key === 'ArrowLeft' || key === 'Left' || keyCode === 37) return -10_000;
  if (key === 'ArrowRight' || key === 'Right' || keyCode === 39) return 10_000;
  return undefined;
}

export function playerBufferedTimelineEnabled(samsungControls: boolean): boolean {
  return !samsungControls;
}

export function playerControlShowsPlay(intentPaused: boolean, failed: boolean): boolean {
  return failed || intentPaused;
}

export function webArrowTargetOwnsKey(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // Left/right are transport controls everywhere in the Web player, including
  // while range inputs have focus. Preserve native arrow editing only for
  // controls where horizontal cursor/selection movement is the likely intent.
  return Boolean(target.closest('textarea, select, [contenteditable="true"], input:not([type="range"])'));
}

export const isSubtitleOnlyUpdate = isSubtitleOnlyPlaybackUpdate;

function PlayerSession({ api, media, platform, runtime, startPositionMs, presentation, onProgress, onPosition, onMinimize, onExpand, onStop, onPrevious, onNext, onEnded, canPrevious, canNext, queuePosition, volume, onVolumeChange }: Omit<Props, 'request'> & { media: MediaSummary; startPositionMs: number }) {
  const pageRef = useRef<HTMLElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const scrubValueRef = useRef<number | undefined>(undefined);
  const lastReportRef = useRef(0);
  const lastPositionPersistRef = useRef(0);
  const endedHandledRef = useRef(false);
  const lastEventByMediaRef = useRef(new Map<string, PlaybackEvent>());
  const log = useMemo(() => createClientLogger('playback.screen', { mediaId: media.id }), [media.id]);
  const webControls = platform.name === 'web';
  const samsungControls = import.meta.env.MODE === 'samsung';
  const interactionControlled = webControls || samsungControls;
  const [runtimePlayback, setRuntimePlayback] = useState<PlaybackCoordinatorSnapshot | undefined>(() => runtime.getPlaybackSnapshot());
  const [runtimeState, setRuntimeState] = useState<PlaybackRuntimeSnapshot>(() => runtime.getSnapshot());
  const playback: PlaybackCoordinatorSnapshot = runtimePlayback ?? {
    intent: { positionMs: Math.max(0, startPositionMs), paused: true },
    event: {
      positionMs: Math.max(0, startPositionMs),
      durationMs: media.durationMs ?? 0,
      paused: true,
      ended: false,
    },
    starting: runtimeState.phase === 'starting',
    preparingSource: false,
    fatalError: runtimeState.fatalError,
  };
  const [controlsVisible, setControlsVisible] = useState(!interactionControlled);
  const [fullscreen, setFullscreen] = useState(false);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [scrubValue, setScrubValue] = useState<number>();
  const [localNotice, setLocalNotice] = useState<string>();
  const backdrop = useArtworkUrl(api, media.artwork?.backdrop ?? media.artwork?.thumbnail ?? media.artwork?.poster);
  const cover = useArtworkUrl(api, media.kind === 'track' ? media.artwork?.poster ?? media.artwork?.thumbnail : undefined);

  useEffect(() => {
    lastReportRef.current = 0;
    lastPositionPersistRef.current = 0;
    endedHandledRef.current = false;
    scrubValueRef.current = undefined;
    setScrubValue(undefined);
    setLocalNotice(undefined);
    setOptionsVisible(false);
  }, [media.id]);

  useEffect(() => {
    runtime.setVolume(samsungControls ? 1 : volume);
  }, [runtime, samsungControls, volume]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    log.info('player-mount', {
      itemId: media.id,
      mediaKind: media.kind,
      startPositionMs,
      catalogueDurationMs: media.durationMs,
      platform: platform.name,
    });
    runtime.attach(host);
    const unsubscribePlayback = runtime.subscribePlayback(setRuntimePlayback);
    const unsubscribeLifecycle = runtime.subscribeLifecycle(setRuntimeState);
    return () => {
      const latest = runtime.getPlaybackSnapshot();
      log.info('player-unmount', { sessionId: latest?.session?.sessionId, latest: latest?.event });
      unsubscribePlayback();
      unsubscribeLifecycle();
      runtime.detach(host);
    };
  }, [log, media.durationMs, media.id, media.kind, platform.name, runtime, startPositionMs]);

  useEffect(() => {
    const event = playback.event;
    lastEventByMediaRef.current.set(media.id, event);
    const now = Date.now();
    if (event.paused || event.ended || now - lastPositionPersistRef.current >= 5_000) {
      lastPositionPersistRef.current = now;
      onPosition(media, event.positionMs, event.durationMs);
    }
    if (shouldTrackProgress(media) && (event.ended || now - lastReportRef.current >= 10_000)) {
      lastReportRef.current = now;
      onProgress({
        mediaId: media.id,
        positionMs: event.positionMs,
        durationMs: event.durationMs,
        updatedAt: now,
        media,
      });
    }
  }, [media, onPosition, onProgress, playback.event]);

  useEffect(() => () => {
    if (!shouldTrackProgress(media)) return;
    const event = lastEventByMediaRef.current.get(media.id);
    lastEventByMediaRef.current.delete(media.id);
    if (!event?.durationMs) return;
    onProgress({
      mediaId: media.id,
      positionMs: event.positionMs,
      durationMs: event.durationMs,
      updatedAt: Date.now(),
      media,
    });
  }, [media, onProgress]);

  useEffect(() => {
    if (!playback.event.ended) {
      endedHandledRef.current = false;
      return;
    }
    if (endedHandledRef.current) return;
    endedHandledRef.current = true;
    onEnded();
  }, [onEnded, playback.event.ended]);

  const fatalError = runtimeState.fatalError ?? playback.fatalError;
  const playbackNotice = localNotice ?? playback.notice;

  const hideControls = useCallback(() => {
    if (hideTimerRef.current !== undefined) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = undefined;
    }
    if (fatalError) return;
    setControlsVisible(false);
    setOptionsVisible(false);
    const chrome = chromeRef.current;
    if (!chrome) return;
    for (const selected of chrome.querySelectorAll<HTMLElement>('[data-tv-selected]')) selected.removeAttribute('data-tv-selected');
    const active = document.activeElement;
    if (active instanceof HTMLElement && chrome.contains(active)) active.blur();
  }, [fatalError]);

  const armControlsHide = useCallback(() => {
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = undefined;
    if (fatalError) return;
    if (!interactionControlled && (playback.intent.paused || optionsVisible)) return;
    hideTimerRef.current = window.setTimeout(hideControls, uiSettings.playerControlsHideDelayMs);
  }, [fatalError, hideControls, interactionControlled, optionsVisible, playback.intent.paused]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    armControlsHide();
  }, [armControlsHide]);

  const focusSamsungControls = useCallback(() => {
    const chrome = chromeRef.current;
    if (!chrome) return;
    const elements = Array.from(chrome.querySelectorAll<HTMLElement>('[data-tv-focusable="true"]:not([disabled])'));
    if (elements.length === 0) return;
    for (const element of elements) element.removeAttribute('data-tv-selected');
    const preferred = elements.find((element) => element.getAttribute('data-tv-default-focus') === 'true') ?? elements[0];
    preferred.setAttribute('data-tv-selected', 'true');
    preferred.focus();
  }, []);

  const noteWebPointerMovement = useCallback((clientY: number) => {
    if (presentation !== 'full' || !webControls) return;
    const chrome = chromeRef.current;
    if (!chrome) return;
    const bounds = chrome.getBoundingClientRect();
    if (clientY < bounds.top || clientY > bounds.bottom) return;
    showControls();
  }, [presentation, showControls, webControls]);

  const setScrubPosition = useCallback((positionMs: number | undefined) => {
    scrubValueRef.current = positionMs;
    setScrubValue(positionMs);
  }, []);

  const setPaused = useCallback((paused: boolean) => {
    setLocalNotice(undefined);
    runtime.setPaused(paused);
    if (!interactionControlled) {
      if (paused) {
        setControlsVisible(true);
        if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
      } else {
        showControls();
      }
    }
  }, [interactionControlled, runtime, showControls]);

  const seek = useCallback((positionMs: number) => {
    setLocalNotice(undefined);
    setScrubPosition(undefined);
    const accepted = runtime.seek(positionMs);
    if (!accepted) setLocalNotice(runtime.getPlaybackSnapshot()?.notice);
    if (!interactionControlled) showControls();
    return accepted;
  }, [interactionControlled, runtime, setScrubPosition, showControls]);

  const seekBy = useCallback((deltaMs: number) => {
    setLocalNotice(undefined);
    setScrubPosition(undefined);
    runtime.seekBy(deltaMs);
    if (!interactionControlled) showControls();
  }, [interactionControlled, runtime, setScrubPosition, showControls]);

  const playFromStart = useCallback(() => {
    log.info('restart-ui-request', {
      sessionId: playback.session?.sessionId,
      mode: playback.session?.mode,
      currentPositionMs: playback.event.positionMs,
    });
    runtime.seek(0);
    runtime.setPaused(false);
  }, [log, playback.event.positionMs, playback.session?.mode, playback.session?.sessionId, runtime]);

  const reconfigure = useCallback((update: PlaybackUpdate) => {
    setLocalNotice(undefined);
    runtime.update(update);
  }, [runtime]);

  useEffect(() => {
    if (presentation === 'full') {
      if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = undefined;
      setOptionsVisible(false);
      setControlsVisible(!interactionControlled);
    }
    return () => {
      if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    };
  }, [interactionControlled, presentation]);

  useEffect(() => {
    if (!fatalError) return;
    setControlsVisible(true);
    setOptionsVisible(false);
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
  }, [fatalError]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === pageRef.current);
      if (presentation === 'full' && !interactionControlled) showControls();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [interactionControlled, presentation, showControls]);

  useEffect(() => {
    if (presentation === 'mini' && document.fullscreenElement === pageRef.current) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [presentation]);

  useEffect(() => {
    if (samsungControls) requestTvDefaultFocus();
  }, [presentation, samsungControls]);

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
      const samsungBack = samsungControls && (
        keyEvent.keyCode === 10009
        || keyEvent.key === 'Escape'
        || keyEvent.key === 'Backspace'
        || keyEvent.key === 'BrowserBack'
        || keyEvent.key === 'XF86Back'
      );
      const samsungOk = samsungControls && (keyEvent.key === 'Enter' || keyEvent.keyCode === 13);
      const samsungDirection = samsungControls && (
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Left', 'Right', 'Up', 'Down'].includes(keyEvent.key)
        || [37, 38, 39, 40].includes(keyEvent.keyCode)
      );

      if (presentation === 'full' && samsungBack) {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        onMinimize();
        return;
      }
      if (presentation === 'full' && samsungOk && !controlsVisible) {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        showControls();
        window.setTimeout(focusSamsungControls, 0);
        return;
      }
      if (presentation === 'full' && samsungControls) {
        const delta = samsungSeekDeltaForKey(keyEvent.key, keyEvent.keyCode, controlsVisible);
        if (delta !== undefined) {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          seekBy(delta);
          return;
        }
      }
      if (presentation === 'full' && samsungDirection) {
        if (!controlsVisible) {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          return;
        }
        armControlsHide();
      }
      if (presentation === 'full' && !samsungControls && keyEvent.key === 'Escape' && document.fullscreenElement) return;
      if (presentation === 'full' && !samsungControls && (keyEvent.key === 'Escape' || keyEvent.key === 'Backspace')) {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        if (optionsVisible) setOptionsVisible(false);
        else onMinimize();
        return;
      }
      if (keyEvent.key === 'MediaPlayPause' || (presentation === 'full' && keyEvent.key === ' ')) {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        setPaused(!playback.intent.paused);
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
      if (presentation === 'full' && webControls && !keyEvent.altKey && !keyEvent.ctrlKey && !keyEvent.metaKey) {
        const delta = webSeekDeltaForKey(keyEvent.key);
        if (delta !== undefined && !webArrowTargetOwnsKey(keyEvent.target)) {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          showControls();
          seekBy(delta);
          return;
        }
      }
      if (keyEvent.key === 'MediaRewind') {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        seekBy(-10_000);
        return;
      }
      if (keyEvent.key === 'MediaFastForward') {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        seekBy(10_000);
        return;
      }
      if (presentation === 'full' && !interactionControlled) showControls();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [armControlsHide, controlsVisible, focusSamsungControls, interactionControlled, onMinimize, optionsVisible, playback.intent.paused, presentation, samsungControls, seekBy, setPaused, showControls, webControls]);

  const session = playback.session;
  const event = playback.event;
  const duration = session?.durationMs || event.durationMs || media.durationMs || 1;
  const displayedProgress = scrubValue ?? Math.min(duration, playback.intent.positionMs);
  const playedPercent = Math.max(0, Math.min(100, displayedProgress / Math.max(1, duration) * 100));
  const bufferedSegments = useMemo(
    () => playerBufferedTimelineEnabled(samsungControls)
      ? bufferedTimelineSegments(playback.event.bufferedRangesMs, duration)
      : [],
    [duration, playback.event.bufferedRangesMs, samsungControls],
  );
  const scrubberVisual = (
    <span className="player-scrubber-visual" aria-hidden="true">
      {bufferedSegments.map((range, index) => (
        <span
          className="player-scrubber-buffered"
          key={`${index}:${range.leftPercent.toFixed(4)}:${range.widthPercent.toFixed(4)}`}
          style={{ left: `${range.leftPercent}%`, width: `${range.widthPercent}%` }}
        />
      ))}
      <span className="player-scrubber-played" style={{ width: `${playedPercent}%` }} />
    </span>
  );
  const audio = media.kind === 'track';
  const streamStatus = describePlaybackSession(session, event.streamOrigin);
  const mediaSubtitle = media.kind === 'episode'
    ? `${media.playbackContext?.series.title ?? ''} ${media.subtitle ?? ''}`.trim()
    : media.subtitle;
  const pausedForControl = playerControlShowsPlay(playback.intent.paused, Boolean(fatalError));
  const queueLabel = queuePosition && queuePosition.total > 1 ? `${queuePosition.index + 1} of ${queuePosition.total}` : undefined;
  const playerSubtitle = [mediaSubtitle, queueLabel].filter(Boolean).join(' · ');
  const showBuffering = !fatalError && (playback.starting || Boolean(event.buffering));

  return (
    <section
      ref={pageRef}
      className={`player-page player-presentation-${presentation} ${audio ? 'audio-player' : ''} ${fullscreen && !controlsVisible && !fatalError ? 'cursor-hidden' : ''} ${fatalError ? 'player-failed' : ''}`}
      onPointerMove={(pointerEvent) => {
        if (presentation !== 'full') return;
        if (webControls) {
          if (!pointerEvent.pointerType || pointerEvent.pointerType === 'mouse') noteWebPointerMovement(pointerEvent.clientY);
        } else if (!samsungControls) {
          showControls();
        }
      }}
      onPointerDown={() => {
        if (presentation === 'full' && !interactionControlled) showControls();
      }}
      onClick={(clickEvent: MouseEvent<HTMLElement>) => {
        if (presentation === 'full') {
          if (webControls) {
            const target = clickEvent.target as HTMLElement;
            if (!target.closest('.player-chrome')) hideControls();
          }
          return;
        }
        const target = clickEvent.target as HTMLElement;
        if (!target.closest('button, input')) onExpand();
      }}
    >
      {backdrop && <div className="player-backdrop" style={{ backgroundImage: `url(${JSON.stringify(backdrop)})` }} />}
      <div ref={hostRef} className="player-host" />
      {audio && (
        <div className="audio-player-art">
          {cover ? <img src={cover} alt="" /> : <div className="audio-player-placeholder">♪</div>}
        </div>
      )}
      {showBuffering && <Loading delayMs={playback.starting ? 0 : uiSettings.playerSeekSpinnerDelayMs} />}

      {fatalError && (
        <div className="player-fatal-error" role="alert">
          <strong>Playback failed</strong>
          <span>{fatalError.message}</span>
        </div>
      )}

      <div
        ref={chromeRef}
        className={`player-chrome ${controlsVisible || fatalError ? 'visible' : ''}`}
        onPointerDown={() => { if (webControls) showControls(); }}
      >
        <div className="player-titlebar">
          <div className="player-title-copy">
            <strong>{media.title}</strong>
            {playerSubtitle && <span>{playerSubtitle}</span>}
          </div>
          <div className="player-stream-status" aria-live="polite">
            {playbackNotice ? (
              <small>{playbackNotice}</small>
            ) : playback.preparingSource ? (
              <small>Preparing new stream…</small>
            ) : (
              <>
                {streamStatus?.endpoint && <small>{streamStatus.endpoint}</small>}
                {streamStatus?.video && <small>{streamStatus.video}</small>}
                {streamStatus?.audio && <small>{streamStatus.audio}</small>}
                {streamStatus?.subtitle && <small>{streamStatus.subtitle}</small>}
              </>
            )}
          </div>
        </div>

        {optionsVisible && (
          session ? (
            <PlayerOptions session={session} onApply={reconfigure} />
          ) : (
            <div className="player-options player-options-loading" aria-live="polite">
              Playback options are loading. Transport controls remain available.
            </div>
          )
        )}

        <div className="player-scrubber-row">
          <span>{formatTime(displayedProgress)}</span>
          {samsungControls ? (
            <div
              className="player-scrubber-shell player-scrubber-display"
              role="progressbar"
              aria-label="Playback position"
              aria-valuemin={0}
              aria-valuemax={Math.max(1, duration)}
              aria-valuenow={Math.max(0, Math.min(duration, displayedProgress))}
            >
              {scrubberVisual}
            </div>
          ) : (
            <div className="player-scrubber-shell">
              {scrubberVisual}
              <input
                className="player-scrubber"
                type="range"
                min={0}
                max={Math.max(1, duration)}
                step={1_000}
                value={displayedProgress}
                aria-label="Playback position"
                data-tv-focusable="true"
                onChange={(changeEvent: ChangeEvent<HTMLInputElement>) => setScrubPosition(Number(changeEvent.target.value))}
                onPointerUp={() => {
                  const position = scrubValueRef.current;
                  if (position !== undefined) seek(position);
                }}
                onKeyUp={(keyEvent: ReactKeyboardEvent<HTMLInputElement>) => {
                  const position = scrubValueRef.current;
                  if (position !== undefined && ['Home', 'End'].includes(keyEvent.key)) seek(position);
                }}
                onBlur={() => {
                  const position = scrubValueRef.current;
                  if (position !== undefined) seek(position);
                }}
              />
            </div>
          )}
          <span>{formatTime(duration)}</span>
        </div>

        <div className="player-button-row">
          <button type="button" data-tv-focusable="true" onClick={onMinimize} aria-label="Minimise player"><PlayerIcon name="back" /></button>
          {queuePosition && queuePosition.total > 1 && (
            <button type="button" data-tv-focusable="true" onClick={() => { if (canPrevious) onPrevious(); else setLocalNotice('Already at the first item.'); }} aria-label="Previous item"><PlayerIcon name="previous" /></button>
          )}
          <button type="button" data-tv-focusable="true" onClick={playFromStart} aria-label="Play from start" title="Play from start"><RestartIcon /></button>
          <button type="button" data-tv-focusable="true" onClick={() => seekBy(-10_000)} aria-label="Seek backward"><PlayerIcon name="rewind" /></button>
          <button type="button" data-tv-focusable="true" data-tv-default-focus={samsungControls ? 'true' : undefined} onClick={() => setPaused(!pausedForControl)} aria-label={pausedForControl ? 'Play' : 'Pause'}>
            {pausedForControl ? <PlayIcon /> : <PlayerIcon name="pause" />}
          </button>
          <button type="button" data-tv-focusable="true" onClick={() => seekBy(10_000)} aria-label="Seek forward"><PlayerIcon name="forward" /></button>
          {queuePosition && queuePosition.total > 1 && (
            <button type="button" data-tv-focusable="true" onClick={() => { if (canNext) onNext(); else setLocalNotice('Already at the last item.'); }} aria-label="Next item"><PlayerIcon name="next" /></button>
          )}
          <button
            type="button"
            data-tv-focusable="true"
            className={optionsVisible ? 'selected' : undefined}
            onClick={() => {
              setOptionsVisible((visible) => !visible);
              if (!interactionControlled) showControls();
            }}
            aria-label="Playback options"
          >
            <PlayerIcon name="options" />
          </button>
          {!samsungControls && <VolumeControl volume={volume} onChange={onVolumeChange} />}
          {platform.name === 'web' && document.fullscreenEnabled && (
            <button type="button" data-tv-focusable="true" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              <PlayerIcon name={fullscreen ? 'fullscreen-exit' : 'fullscreen'} />
            </button>
          )}
          <button type="button" data-tv-focusable="true" onClick={onStop} aria-label="Stop playback and close player" title="Close player"><PlayerIcon name="close" /></button>
        </div>
      </div>

      <div className="player-mini-chrome" aria-label="Now playing">
        <button className="player-mini-copy" type="button" data-tv-focusable="true" onClick={onExpand} aria-label={`Open player for ${media.title}`}>
          <span className="player-mini-title">{media.title}</span>
          <span className="player-mini-subtitle">{fatalError ? `Playback failed · ${fatalError.message}` : playerSubtitle || 'Now playing'}</span>
          <span className="player-mini-time">{formatTime(displayedProgress)} / {formatTime(duration)}</span>
          <span className="player-mini-progress" aria-hidden="true"><span style={{ width: `${Math.min(100, displayedProgress / Math.max(1, duration) * 100)}%` }} /></span>
        </button>
        <div className="player-mini-controls">
          {queuePosition && queuePosition.total > 1 && (
            <button type="button" data-tv-focusable="true" onClick={() => { if (canPrevious) onPrevious(); else setLocalNotice('Already at the first item.'); }} aria-label="Previous item"><PlayerIcon name="previous" /></button>
          )}
          <button type="button" data-tv-focusable="true" data-tv-default-focus={samsungControls ? 'true' : undefined} onClick={() => setPaused(!pausedForControl)} aria-label={pausedForControl ? 'Play' : 'Pause'}>
            {pausedForControl ? <PlayIcon /> : <PlayerIcon name="pause" />}
          </button>
          {queuePosition && queuePosition.total > 1 && (
            <button type="button" data-tv-focusable="true" onClick={() => { if (canNext) onNext(); else setLocalNotice('Already at the last item.'); }} aria-label="Next item"><PlayerIcon name="next" /></button>
          )}
          {!samsungControls && <VolumeControl volume={volume} onChange={onVolumeChange} compact />}
          <button type="button" data-tv-focusable="true" onClick={onExpand} aria-label="Open full player"><PlayerIcon name="expand" /></button>
          <button type="button" data-tv-focusable="true" onClick={onStop} aria-label="Stop playback"><PlayerIcon name="close" /></button>
        </div>
      </div>
    </section>
  );
}

export function PlayerHost(props: Props) {
  const { request, ...sessionProps } = props;
  return (
    <PlayerSession
      {...sessionProps}
      media={request.media}
      startPositionMs={request.startPositionMs}
    />
  );
}
