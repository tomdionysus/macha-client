import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react';
import type { EndpointCandidate, MediaApi, PlaybackCapabilities } from '@machafoundation/core';
import { PlayIcon, RestartIcon } from '../components/PlaybackIcons';
import { Loading } from '../components/Status';
import { createClientLogger } from '@machafoundation/core';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { requestTvDefaultFocus } from '../hooks/useTvNavigation';
import { useElapsedMs } from '../hooks/useElapsedMs';
import { usePointerIdle } from '../hooks/usePointerIdle';
import { cardSubtitle, episodeCode, playbackNoticeText, playbackTimeText, startProgressText, streamStatusText, tooSlowToPlayText } from '../text/viewerText';
import { TrackFacts } from './player/TrackFacts';
import { useAsync } from '../hooks/useAsync';
import type { Platform } from '@machafoundation/core';
import { platformTraits } from '../platform/traits';
import type { PlaybackUpdate } from '@machafoundation/core';
import { offeredModes, type PlaybackStartProgress, progressFor, technicalSummary, technicalProfileFromSession, type OfferedMode, type PlaybackCoordinatorSnapshot, type PlaybackPolicyOverrides, type PlaybackSession } from '@machafoundation/core';
import { PlaybackRuntime, type PlaybackRuntimeRequest, type PlaybackRuntimeSnapshot } from '@machafoundation/core';
import { uiSettings } from '../settings';
import { describePlaybackSession } from '@machafoundation/core';
import { playbackFailureTrail, type PlaybackFailureTrailEntry } from './player/failureTrail';
import { nodeName, playerNodeChoices } from './player/nodeChoices';
import { moveStreamToNode } from './player/nodeMove';
import { nodeStartCosts } from '../playback/nodeStartCosts';
import { MOVE_LEAD_MARGIN_MS, playbackFailureCode, TOO_SLOW_TO_PLAY_CODE } from '@machafoundation/core';
import { failureTrailEnabled } from '../diagnostics/failureTrailSetting';
import { accountSessionLimitNotice, playbackFailureHeadline } from '../diagnostics/failureCauses';
import { bufferedTimelineSegments } from '@machafoundation/core';
import type { MediaSummary, PlaybackEvent, PlaybackProgress } from '@machafoundation/core';
import { PlayerOptions } from './player/PlayerOptions';
import { accelerateSeek, committingScrubberKey, seekDirectionForKey, type SeekDirection, type SeekHold } from './player/seekAcceleration';
import { samsungMediaCommand } from '../platform/SamsungMediaKeys';

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
  /** Every node this client knows, for the node picker. */
  endpoints?: readonly EndpointCandidate[];
  /** The cluster's name for the node behind an endpoint. */
  nodeNameOf?: (endpointId: string) => string | undefined;
  /** Pins this node at the head of the app's registry order, where it stays. */
  onPinEndpoint?: (endpointIds: readonly string[]) => string | undefined;
  /** Offer every option, not only those the device's capabilities allow. */
  offerAll?: boolean;
}


/**
 * What to tell a viewer whose title has not started yet, so a slow start is not an unexplained
 * spinner. Only for a start: a rebuffer has the picture behind it. A node that reports its stage
 * supplies `stage`, which replaces the general sentence.
 */
export function startWaitNotice(starting: boolean, elapsedMs: number, stage?: string): string | undefined {
  if (!starting || elapsedMs < uiSettings.playerStartWaitNoticeMs) return undefined;
  return `${stage ?? 'Waiting for the node to start the stream'} · ${Math.floor(elapsedMs / 1_000)}s`;
}

/**
 * The status line while a new stream is prepared behind the one playing. A change is built on the
 * serving node, so that node is named; a start (a failover included) is on a node this line
 * cannot name, since the endpoint it holds is the one being replaced.
 */
export function preparingStreamText(progress: PlaybackStartProgress | undefined, endpoint: string | undefined): string {
  const stage = progress && startProgressText({ ...progress, kind: 'change' }, progress.kind === 'change' ? endpoint : undefined, true);
  if (stage) return stage;
  return endpoint ? `Preparing new stream on ${endpoint}…` : 'Preparing new stream…';
}

export function firstUsableDurationMs(...candidates: (number | undefined)[]): number {
  for (const candidate of candidates) {
    if (candidate !== undefined && Number.isFinite(candidate) && candidate > 0) return candidate;
  }
  return 1;
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

/** The line under the title: an episode's series and code, a movie's year, else its card's line. */
export function playerMediaSubtitle(media: MediaSummary): string | undefined {
  if (media.kind === 'episode') {
    return `${media.playbackContext?.series.title ?? ''} ${episodeCode(media) ?? ''}`.trim() || undefined;
  }
  return cardSubtitle(media);
}

export function webSeekDeltaForKey(key: string): number | undefined {
  if (key === 'ArrowLeft') return -10_000;
  if (key === 'ArrowRight') return 10_000;
  return undefined;
}

/**
 * Which way a transport shortcut seeks, or undefined when the keys belong to navigation. Left and
 * right are transport while the chrome is hidden, and while the bar is up only because a seek
 * revealed it, so a held seek is not disarmed by the chrome it summoned.
 */
export function samsungTransportSeekDirection(
  key: string,
  keyCode: number,
  transportActive: boolean,
): SeekDirection | undefined {
  return transportActive ? seekDirectionForKey(key, keyCode) : undefined;
}

// Seek distance accelerates with how long the key is held: see `./player/seekAcceleration`.

export function boundedPlayerSeekTarget(positionMs: number, deltaMs: number, durationMs: number): number {
  return Math.max(0, Math.min(Math.max(0, durationMs), positionMs + deltaMs));
}

export function playerBufferedTimelineEnabled(samsungControls: boolean): boolean {
  return !samsungControls;
}

/** Only a pointer can reach the floating mini-player, so only `webControls` platforms minimise; the rest close. */
export function playerBackAction(webControls: boolean): 'minimize' | 'stop' {
  return webControls ? 'minimize' : 'stop';
}

export function playerControlShowsPlay(intentPaused: boolean, failed: boolean): boolean {
  return failed || intentPaused;
}

export function webArrowTargetOwnsKey(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // Left and right are transport everywhere, range inputs included; only text-like controls keep them.
  return Boolean(target.closest('textarea, select, [contenteditable="true"], input:not([type="range"])'));
}

function PlayerSession({ api, media, platform, runtime, startPositionMs, presentation, onProgress, onPosition, onMinimize, onExpand, onStop, onPrevious, onNext, onEnded, canPrevious, canNext, queuePosition, volume, onVolumeChange, endpoints, nodeNameOf, onPinEndpoint, offerAll = false }: Omit<Props, 'request'> & { media: MediaSummary; startPositionMs: number }) {
  const pageRef = useRef<HTMLElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const hoveringChromeRef = useRef(false);
  const scrubValueRef = useRef<number | undefined>(undefined);
  const lastReportRef = useRef(0);
  const lastPositionPersistRef = useRef(0);
  const endedHandledRef = useRef(false);
  /** The in-progress D-pad hold on the scrubber. */
  const seekHoldRef = useRef<SeekHold | undefined>(undefined);
  /** True while the control bar is up only because a transport seek revealed it. */
  const seekRevealedControlsRef = useRef(false);
  const lastEventByMediaRef = useRef(new Map<string, PlaybackEvent>());
  // How the title was last seen playing, for the save on exit, when the snapshot may be gone.
  const lastPlayingRef = useRef<PlaybackCoordinatorSnapshot | undefined>(undefined);
  const log = useMemo(() => createClientLogger('playback.screen', { mediaId: media.id }), [media.id]);
  const traits = platformTraits(platform);
  const webControls = traits.hasPointerControls;
  const samsungControls = traits.usesRemoteMediaControls;
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
  const pointer = usePointerIdle(uiSettings.playerControlsHideDelayMs);
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
    hoveringChromeRef.current = false;
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
      lastPlayingRef.current = runtimePlayback;
      onProgress(progressFor(media, event.positionMs, event.durationMs, runtimePlayback));
    }
  }, [media, onPosition, onProgress, playback.event, runtimePlayback]);

  useEffect(() => () => {
    if (!shouldTrackProgress(media)) return;
    const event = lastEventByMediaRef.current.get(media.id);
    lastEventByMediaRef.current.delete(media.id);
    if (!event?.durationMs) return;
    onProgress(progressFor(media, event.positionMs, event.durationMs, lastPlayingRef.current));
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
  const playbackNotice = localNotice ?? (playback.notice && playbackNoticeText(playback.notice, runtimePlayback?.instruction?.quality));

  const hideControls = useCallback(() => {
    if (hideTimerRef.current !== undefined) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = undefined;
    }
    if (fatalError || hoveringChromeRef.current) return;
    seekRevealedControlsRef.current = false;
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
    // Stay up through a status change (seek, reconfiguration, subtitle load) so the input visibly registers.
    if (playback.preparingSource) return;
    // Never auto-hide under a resting pointer.
    if (hoveringChromeRef.current) return;
    if (!interactionControlled && (playback.intent.paused || optionsVisible)) return;
    hideTimerRef.current = window.setTimeout(hideControls, uiSettings.playerControlsHideDelayMs);
  }, [fatalError, hideControls, interactionControlled, optionsVisible, playback.intent.paused, playback.preparingSource]);

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

  // Freeze the picture when a seek is committed, before core decides how to serve it: core reports
  // nothing until a replacement exists. A buffered target releases in the same tick, at no cost.
  const holdPicture = useCallback(() => {
    (platform as Partial<{ holdPicture(): void }>).holdPicture?.();
  }, [platform]);

  const releasePicture = useCallback(() => {
    (platform as Partial<{ releasePicture(): void }>).releasePicture?.();
  }, [platform]);

  const seek = useCallback((positionMs: number) => {
    setLocalNotice(undefined);
    setScrubPosition(undefined);
    holdPicture();
    // Whole milliseconds: a range input returns its maximum exactly, and a fractional duration at the
    // end of the title is where a node is most likely to clamp and round.
    const accepted = runtime.seek(Math.round(positionMs));
    // A refused seek moves nothing, so the hold is released.
    if (!accepted) {
      releasePicture();
      const notice = runtime.getPlaybackSnapshot()?.notice;
      setLocalNotice(notice && playbackNoticeText(notice, runtime.getPlaybackSnapshot()?.instruction?.quality));
    }
    if (!interactionControlled) showControls();
    return accepted;
  }, [holdPicture, interactionControlled, releasePicture, runtime, setScrubPosition, showControls]);

  const seekBy = useCallback((deltaMs: number) => {
    setLocalNotice(undefined);
    setScrubPosition(undefined);
    holdPicture();
    if (!runtime.seekBy(deltaMs)) releasePicture();
    if (!interactionControlled) showControls();
  }, [holdPicture, interactionControlled, releasePicture, runtime, setScrubPosition, showControls]);

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

  const nodeChoices = useMemo(
    () => playerNodeChoices(endpoints ?? [], playback.session?.endpoint?.id, nodeNameOf),
    [endpoints, nodeNameOf, playback.session?.endpoint?.id],
  );
  // What this device can decode, asked once per player; it decides what a remux may ask the node to copy.
  const [capabilities, setCapabilities] = useState<PlaybackCapabilities | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void platform.capabilities()
      .then((detected) => { if (!cancelled) setCapabilities(detected); })
      .catch(() => { /* Unknown capabilities make remux transcode audio, which always works. */ });
    return () => { cancelled = true; };
  }, [platform]);
  const [movingToNode, setMovingToNode] = useState<string | undefined>(undefined);
  /**
   * Sends this stream to the node the viewer picked, at the current position. Core's `moveTo` builds
   * a session there under the playing picture, then swaps; `play()` would restart through black.
   * The pin is set before the request so the resolver chooses that node, and stays for later seeks,
   * mode changes and recovery.
   */
  const selectNode = useCallback((nodeId: string) => {
    const choice = nodeChoices.find((node) => node.id === nodeId);
    if (!onPinEndpoint || !choice) return;
    const positionMs = Math.max(0, Math.round(scrubValueRef.current ?? playback.intent.positionMs));
    // This viewer's latest start cost for that node plus core's margin; with none, core estimates.
    const measured = nodeStartCosts.forNode(choice.endpointIds);
    const leadMs = measured ? measured.costMs + MOVE_LEAD_MARGIN_MS : undefined;
    log.info('node-move-request', {
      from: playback.session?.endpoint?.id,
      to: choice.endpointIds,
      positionMs,
      leadMs,
      measuredStartCostMs: measured?.costMs,
      measuredAgeMs: measured?.ageMs,
      sessionId: playback.session?.sessionId,
    });
    setLocalNotice(undefined);
    const endpointId = onPinEndpoint(choice.endpointIds);
    if (endpointId === undefined) return;
    setMovingToNode(nodeId);
    // Cleared when the move settles: a move never removes the session, so that cannot be the signal.
    void moveStreamToNode(runtime, endpointId, Boolean(fatalError), leadMs)
      .then((outcome) => {
        log.info('node-move-settled', { to: endpointId, outcome });
        if (outcome === 'refused') {
          setLocalNotice(`${choice.label} could not take this stream, so it is still playing from here.`);
        }
      })
      .finally(() => setMovingToNode(undefined));
  }, [fatalError, log, nodeChoices, onPinEndpoint, playback.intent.positionMs, playback.session?.endpoint?.id, playback.session?.sessionId, runtime]);

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

  // Read once, when the failure lands: the buffer keeps filling and would push the evidence off the list.
  const [failureTrail, setFailureTrail] = useState<PlaybackFailureTrailEntry[]>([]);
  useEffect(() => {
    setFailureTrail(fatalError && failureTrailEnabled() ? playbackFailureTrail() : []);
  }, [fatalError]);

  useEffect(() => {
    if (!fatalError) return;
    setControlsVisible(true);
    setOptionsVisible(false);
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
  }, [fatalError]);

  useEffect(() => {
    if (!playback.preparingSource) {
      armControlsHide();
      return;
    }
    // Only for a change to a playing stream, where the bar acknowledges the input; at startup it
    // would flash chrome over a title just appearing.
    if (playback.session) setControlsVisible(true);
    if (hideTimerRef.current !== undefined) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = undefined;
    }
  }, [armControlsHide, playback.preparingSource, playback.session]);

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
    if (!webControls || !document.fullscreenEnabled || !pageRef.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await pageRef.current.requestFullscreen();
    } catch (error) {
      log.warn('fullscreen-failed', { error });
    }
  }, [log, webControls]);

  useEffect(() => {
    // Android intercepts its back button natively before any keydown fires, so MainActivity calls
    // this directly, falling back to its own behaviour when it is absent or returns false.
    const host = window as unknown as { __machaHandleBack?: () => boolean };
    host.__machaHandleBack = () => {
      if (presentation !== 'full') return false;
      onStop();
      return true;
    };
    return () => { delete host.__machaHandleBack; };
  }, [onStop, presentation]);

  useEffect(() => {
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      const mediaCommand = samsungMediaCommand(keyEvent.key, samsungControls ? keyEvent.keyCode : 0);
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
        if (scrubValueRef.current !== undefined && keyEvent.target instanceof HTMLInputElement && keyEvent.target.classList.contains('player-scrubber')) {
          setScrubPosition(undefined);
          return;
        }
        // A TV remote has no pointer to reach a mini player, so Back closes outright.
        onStop();
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
        // Left and right stay transport while a seek revealed the bar: see samsungTransportSeekDirection.
        const transportActive = !controlsVisible || seekRevealedControlsRef.current;
        const direction = samsungTransportSeekDirection(keyEvent.key, keyEvent.keyCode, transportActive);
        if (direction !== undefined) {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          // The scrubber's ladder and hold, so the distance does not depend on whether the bar is up.
          const { hold, deltaMs } = accelerateSeek(seekHoldRef.current, direction, Date.now());
          seekHoldRef.current = hold;
          seekBy(deltaMs);
          // Show the scrubber so the viewer can see where the seek landed.
          seekRevealedControlsRef.current = true;
          showControls();
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
        if (optionsVisible) { setOptionsVisible(false); return; }
        // Non-web here is Android with a keyboard in a dev build; a device's back button is intercepted natively.
        if (playerBackAction(webControls) === 'minimize') onMinimize();
        else onStop();
        return;
      }
      if (mediaCommand || (presentation === 'full' && keyEvent.key === ' ')) {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        if (keyEvent.repeat && mediaCommand !== 'rewind' && mediaCommand !== 'fast-forward') return;
        switch (mediaCommand) {
          case 'play': setPaused(false); break;
          case 'pause': setPaused(true); break;
          case 'previous':
            if (canPrevious) onPrevious();
            else setLocalNotice('Already at the first item.');
            break;
          case 'next':
            if (canNext) onNext();
            else setLocalNotice('Already at the last item.');
            break;
          case 'stop': onStop(); break;
          case 'rewind': seekBy(-10_000); break;
          case 'fast-forward': seekBy(10_000); break;
          case 'toggle':
          default: setPaused(!playback.intent.paused); break;
        }
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
      if (presentation === 'full' && !interactionControlled) showControls();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [armControlsHide, canNext, canPrevious, controlsVisible, focusSamsungControls, interactionControlled, onMinimize, onNext, onPrevious, onStop, optionsVisible, playback.intent.paused, presentation, samsungControls, seekBy, setPaused, setScrubPosition, showControls, webControls]);

  const session = playback.session;
  const offered = useMemo(
    () => modesToOffer(runtimePlayback?.modes, session, capabilities, (platform as { playbackPolicy?: PlaybackPolicyOverrides }).playbackPolicy, offerAll),
    [capabilities, offerAll, platform, runtimePlayback?.modes, session],
  );
  const event = playback.event;
  const duration = firstUsableDurationMs(session?.durationMs, event.durationMs, media.durationMs);
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
  // The playing track's format line, from the catalogue profile of the file the session names.
  const playingMediaId = audio ? session?.mediaId : undefined;
  const trackFormat = useAsync(
    async (signal) => {
      if (!playingMediaId?.startsWith('macha:') || !api.mediaProfile) return undefined;
      const profile = await api.mediaProfile(playingMediaId, signal);
      return profile ? technicalSummary(profile).parts : undefined;
    },
    [api, playingMediaId],
  );
  const described = describePlaybackSession(session, event.streamOrigin);
  // The cluster's name for the serving node where core knows it, else its host: never a URL.
  const streamStatus = described && { endpoint: described.endpointName ?? nodeName(described.endpoint), ...streamStatusText(described) };
  const mediaSubtitle = playerMediaSubtitle(media);
  const pausedForControl = playerControlShowsPlay(playback.intent.paused, Boolean(fatalError));
  const queueLabel = queuePosition && queuePosition.total > 1 ? `${queuePosition.index + 1} of ${queuePosition.total}` : undefined;
  const playerSubtitle = [mediaSubtitle, queueLabel].filter(Boolean).join(' · ');
  const tooSlow = Boolean(fatalError) && playbackFailureCode(fatalError) === TOO_SLOW_TO_PLAY_CODE;
  const showBuffering = !fatalError && (playback.starting || Boolean(event.buffering));
  // Counted here: core says `starting` without saying since when.
  const startWaitMs = useElapsedMs(playback.starting);

  return (
    <section
      ref={pageRef}
      className={`player-page player-presentation-${presentation} ${audio ? 'audio-player' : ''} ${fullscreen && !controlsVisible && pointer.idle && !fatalError ? 'cursor-hidden' : ''} ${fatalError ? 'player-failed' : ''}`}
      onPointerMove={(pointerEvent) => {
        if (presentation !== 'full') return;
        // Any movement restores the cursor; the chrome follows its own rules below.
        pointer.noteMovement();
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
      {audio && <TrackFacts track={media} format={trackFormat.value} />}
      {showBuffering && (
        <Loading
          delayMs={playback.starting ? 0 : uiSettings.playerSeekSpinnerDelayMs}
          note={startWaitNotice(
            playback.starting,
            startWaitMs,
            playback.startProgress?.kind === 'start' ? startProgressText(playback.startProgress, streamStatus?.endpoint) : undefined,
          )}
        />
      )}

      {fatalError && (
        <div className="player-fatal-error" role="alert">
          <strong>Playback failed</strong>
          {/* Core's sentence, never `.message`, which carries envelopes and a node address. */}
          <span>{tooSlow ? tooSlowToPlayText(runtimePlayback?.instruction?.quality, session?.transform) : playbackFailureHeadline(fatalError)}</span>
          {tooSlow && (
            <div className="player-failure-actions">
              <button type="button" className="secondary-button" data-tv-focusable="true" data-tv-default-focus="true" onClick={() => { void runtime.retry(); }}>Try again</button>
              {session && (
                <button type="button" className="secondary-button" data-tv-focusable="true" onClick={() => setOptionsVisible(true)}>Choose another quality</button>
              )}
            </div>
          )}
          {/* After the headline: the cap explains why recovery could not finish, not what went wrong. */}
          {accountSessionLimitNotice(fatalError) && (
            <span className="player-failure-notice">{accountSessionLimitNotice(fatalError)}</span>
          )}
          {failureTrail.length > 0 && (
            <ol className="player-failure-trail">
              {failureTrail.map((entry) => (
                <li key={`${entry.atMs}-${entry.event}`}>
                  <span>{(entry.atMs / 1_000).toFixed(1)}s</span>
                  <span>{entry.event}</span>
                  {entry.detail && <span>{entry.detail}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <div
        ref={chromeRef}
        className={`player-chrome ${controlsVisible || fatalError ? 'visible' : ''}`}
        onPointerDown={() => { if (webControls) showControls(); }}
        onPointerEnter={(pointerEvent) => {
          if (!webControls || (pointerEvent.pointerType && pointerEvent.pointerType !== 'mouse')) return;
          hoveringChromeRef.current = true;
          if (hideTimerRef.current !== undefined) {
            window.clearTimeout(hideTimerRef.current);
            hideTimerRef.current = undefined;
          }
        }}
        onPointerLeave={(pointerEvent) => {
          if (!webControls || (pointerEvent.pointerType && pointerEvent.pointerType !== 'mouse')) return;
          hoveringChromeRef.current = false;
          armControlsHide();
        }}
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
              // The endpoint named is the one currently held; it flips to the replacement when that generation activates.
              <small>{preparingStreamText(playback.startProgress, streamStatus?.endpoint)}</small>
            ) : (
              <>
                {/* `CONTAINER : endpoint` on one line. An absent half is omitted, never defaulted: a default
                    would read as an answer. */}
                {(streamStatus?.container || streamStatus?.endpoint) && (
                  <small>{[streamStatus?.container, streamStatus?.endpoint].filter(Boolean).join(' : ')}</small>
                )}
                {streamStatus?.video && <small>{streamStatus.video}</small>}
                {streamStatus?.audio && <small>{streamStatus.audio}</small>}
                {streamStatus?.subtitle && <small>{streamStatus.subtitle}</small>}
              </>
            )}
          </div>
        </div>

        {optionsVisible && (
          session ? (
            <PlayerOptions
              session={session}
              offered={offered}
              pendingPreferences={playback.pendingPreferences}
              instruction={runtimePlayback?.instruction}
              versions={runtimePlayback?.versions}
              onPlayVersion={(step) => { void runtime.playVersion(step); }}
              capabilities={capabilities}
              nodes={nodeChoices}
              movingToNode={movingToNode}
              onApply={reconfigure}
              onSelectNode={onPinEndpoint ? selectNode : undefined}
            />
          ) : (
            <div className="player-options player-options-loading" aria-live="polite">
              Playback options are loading. Transport controls remain available.
            </div>
          )
        )}

        <div className="player-scrubber-row">
          <span>{playbackTimeText(displayedProgress)}</span>
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
              aria-valuetext={`${playbackTimeText(displayedProgress)} of ${playbackTimeText(duration)}`}
              data-tv-focusable="true"
              onChange={(changeEvent: ChangeEvent<HTMLInputElement>) => setScrubPosition(Number(changeEvent.target.value))}
              onPointerUp={() => {
                const position = scrubValueRef.current;
                if (position !== undefined) seek(position);
              }}
              onKeyDown={(keyEvent: ReactKeyboardEvent<HTMLInputElement>) => {
                if (!samsungControls) return;
                const direction = seekDirectionForKey(keyEvent.key, keyEvent.keyCode);
                if (direction === undefined) return;
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                // Only the preview moves; the seek is committed once, on release.
                const { hold, deltaMs } = accelerateSeek(seekHoldRef.current, direction, Date.now());
                seekHoldRef.current = hold;
                const current = scrubValueRef.current ?? Math.min(duration, playback.intent.positionMs);
                setScrubPosition(boundedPlayerSeekTarget(current, deltaMs, duration));
                armControlsHide();
              }}
              onKeyUp={(keyEvent: ReactKeyboardEvent<HTMLInputElement>) => {
                const seekKey = samsungControls
                  ? seekDirectionForKey(keyEvent.key, keyEvent.keyCode)
                  : undefined;
                const commit = seekKey !== undefined || committingScrubberKey(keyEvent.key);
                if (seekKey !== undefined) {
                  keyEvent.preventDefault();
                  keyEvent.stopPropagation();
                  seekHoldRef.current = undefined;
                }
                const position = scrubValueRef.current;
                if (position !== undefined && commit) seek(position);
              }}
              onBlur={() => {
                const position = scrubValueRef.current;
                if (position !== undefined) seek(position);
              }}
            />
          </div>
          <span>{playbackTimeText(duration)}</span>
        </div>

        <div className="player-button-row">
          {webControls && (
            <button type="button" data-tv-focusable="true" onClick={onMinimize} aria-label="Minimise player"><PlayerIcon name="back" /></button>
          )}
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
          {webControls && document.fullscreenEnabled && (
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
          <span className="player-mini-subtitle">{fatalError ? `Playback failed · ${playbackFailureHeadline(fatalError)}` : playerSubtitle || 'Now playing'}</span>
          <span className="player-mini-time">{playbackTimeText(displayedProgress)} / {playbackTimeText(duration)}</span>
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

/**
 * The modes this device can play the file in. Core's answer includes the node's operations and is
 * preferred; until it arrives the session's profile answers, and may offer a remux the node refuses.
 */
export function modesToOffer(
  fromCore: readonly OfferedMode[] | undefined,
  session: PlaybackSession | undefined,
  capabilities: PlaybackCapabilities | undefined,
  overrides: PlaybackPolicyOverrides | undefined,
  offerAll: boolean,
): readonly OfferedMode[] | undefined {
  if (fromCore) return fromCore;
  if (!session || !capabilities) return undefined;
  return offeredModes(technicalProfileFromSession(session), capabilities, { overrides, offerAll });
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
