import type Hls from 'hls.js';
import { loadHls, managedHlsSupported, warmHls } from './hlsRuntime';
import { createClientLogger, SERVER_SEGMENT_HOLD_MS, SERVER_STARTUP_TIMEOUT_MS } from '@machafoundation/core';
import {
  PlaybackSourceError,
  type Platform,
  type PlaybackDegradationListener,
  type PlaybackFailureListener,
  type PlaybackListener,
  type Player,
} from '@machafoundation/core';
import type { KeyframeIndex, MediaTechnicalProfile, PlaybackCapabilities, PlaybackEvent, PlaybackSource, PlaybackTimeRange, PlaybackTransition } from '@machafoundation/core';
import { bufferedTimeRanges } from '@machafoundation/core';
import { ManagedHlsMediaRecoveryBudget } from './ManagedHlsRecovery';
import { MediaStallWatchdog, MediaStartWatchdog } from '@machafoundation/core';
import { browserMediaWatchdogEnvironment } from './mediaWatchdogEnvironment';
import { detectHlsTsSupport, detectWebMediaCodecCapabilities, hlsDeliveryProbe } from './WebMediaCapabilities';
import { WebMediaTimeline } from './WebMediaTimeline';
import {
  addDirectPlayReadAheadAlternative,
  directPlayReadAheadMetrics,
  directPlayReadAheadUrl,
  releaseDirectPlayReadAhead,
  reportFragmentTransfer,
  setDirectPlayReadAheadMode,
  directPlayReadAheadSourceStatus,
  subscribeDirectPlayReadAheadFailure,
} from '../playback/directPlayReadAhead';
import { hlsEventSummary, videoState, WebMediaDiagnostics } from './WebMediaDiagnostics';
import { nodeStartCosts } from '../playback/nodeStartCosts';
import { browserDisplayResolution, type DisplayResolution } from './displayResolution';
import { shouldReportStart, StartRecorder, type StartOutcome, type StartRole, type StartSample } from './startRecorder';
import {
  isHlsNetworkDegradation,
  isHlsSegmentHold,
  isHlsSourceNotFound,
  isSourceGoneStatus,
  managedHlsErrorAction,
  webHlsBufferConfig,
} from './WebHlsPolicy';
import {
  isLegacyWebVtt,
  subtitleSegmentAt,
  subtitleSegmentStarts,
  subtitleSegmentWindow,
  validSubtitleManifest,
  type SubtitleSegmentManifest,
} from './WebSubtitles';

export { hlsEventSummary } from './WebMediaDiagnostics';
export { webHlsBufferConfig } from './WebHlsPolicy';

/** Past this a start is reported as never having shown a frame: a node reclaims an unstreamed session at 120 s. */
const START_RECORD_LIMIT_MS = 120_000;

function clearTextTrackCues(track: TextTrack): void {
  // `cues` is null while disabled; hidden exposes them without rendering.
  track.mode = 'hidden';
  const cues = track.cues;
  if (cues) {
    for (let index = cues.length - 1; index >= 0; index -= 1) {
      const cue = cues[index];
      if (cue) track.removeCue(cue);
    }
  }
  track.mode = 'disabled';
}

function cloneWebVttCue(cue: TextTrackCue): VTTCue | undefined {
  if (typeof VTTCue === 'undefined' || !(cue instanceof VTTCue)) return undefined;
  const clone = new VTTCue(cue.startTime, cue.endTime, cue.text);
  clone.id = cue.id;
  return clone;
}

function firstPlaylistUri(lines: readonly string[]): string | undefined {
  return lines.map((line) => line.trim()).find((line) => Boolean(line) && !line.startsWith('#'));
}

export function webHlsPreflightTargets(manifest: string, manifestUrl: string): {
  variantUrl?: string;
  mediaUrls: string[];
} {
  const lines = manifest.split(/\r?\n/);
  if (lines.some((line) => line.trim().startsWith('#EXT-X-STREAM-INF'))) {
    const variant = firstPlaylistUri(lines);
    return { variantUrl: variant ? new URL(variant, manifestUrl).toString() : undefined, mediaUrls: [] };
  }
  const map = lines
    .map((line) => /^#EXT-X-MAP:.*\bURI="([^"]+)"/i.exec(line.trim())?.[1])
    .find(Boolean);
  const segment = firstPlaylistUri(lines);
  const mediaUrls = [map, segment]
    .filter((value): value is string => Boolean(value))
    .map((value) => new URL(value, manifestUrl).toString())
    .filter((value, index, all) => all.indexOf(value) === index);
  return { mediaUrls };
}

async function readFirstResponseBytes(response: Response): Promise<boolean> {
  if (!response.ok) return false;
  // Chromium 47 (Tizen 3) has `fetch` but no response streams, so `body` is
  // undefined there: read the buffer, which the caller's Range header bounds.
  if (!response.body) return (await response.arrayBuffer()).byteLength > 0;
  const reader = response.body.getReader();
  try {
    const first = await reader.read();
    return !first.done && Boolean(first.value?.byteLength);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * How long a preflight waits before calling a node unable to serve a source;
 * it bounds the whole walk. Derived from the server's budgets: the preflight's
 * own request starts a lazy pipeline, so a shorter deadline would reject a node
 * that is merely still starting. A warm-up must not borrow this number.
 */
export const HLS_PREFLIGHT_TIMEOUT_MS = SERVER_STARTUP_TIMEOUT_MS + SERVER_SEGMENT_HOLD_MS + 4_000;

/**
 * Validates a playlist and its initial fMP4 data without attaching a decoder.
 * The node's stated deadline wins; a missing one falls back to the longer
 * derived constant, never to zero.
 */
export async function preflightWebHlsSource(
  source: PlaybackSource,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = source.budgets?.deadlineMs ?? HLS_PREFLIGHT_TIMEOUT_MS,
): Promise<boolean> {
  if (!source.isManifest) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let manifestUrl = source.url;
    for (let depth = 0; depth < 2; depth += 1) {
      const response = await fetchImpl(manifestUrl, { method: 'GET', cache: 'no-store', signal: controller.signal });
      if (!response.ok) return false;
      const targets = webHlsPreflightTargets(await response.text(), manifestUrl);
      if (targets.variantUrl) {
        manifestUrl = targets.variantUrl;
        continue;
      }
      if (targets.mediaUrls.length === 0) return false;
      for (const url of targets.mediaUrls) {
        const media = await fetchImpl(url, {
          method: 'GET',
          headers: { Range: 'bytes=0-65535' },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!await readFirstResponseBytes(media)) return false;
      }
      return true;
    }
    return false;
  } finally {
    clearTimeout(timeout);
  }
}


/** Handover budgets. Each fails towards the teardown path: a visible gap, never a broken player. */
const HANDOVER_READY_TIMEOUT_MS = 20_000;
/**
 * Wait for the replacement to buffer the join, which lies `clockOffsetMs` in
 * and is not resident at `canplay`. Generous: the viewer is still watching.
 */
const HANDOVER_BUFFER_TIMEOUT_MS = 25_000;
/**
 * Observation window before the replacement's progress counts as a rate: a
 * segment arrives whole, so a shorter span measures quantisation. Covers a
 * segment plus a node's hold. Not a deadline, so not derived from
 * `budgets.segmentHoldMs`.
 */
const HANDOVER_CONVERGENCE_WINDOW_MS = 6_000;
const HANDOVER_BUFFER_POLL_MS = 100;
const HANDOVER_SEEK_TIMEOUT_MS = 8_000;
const HANDOVER_JOIN_TIMEOUT_MS = 20_000;
const HANDOVER_JOIN_POLL_MS = 20;
/**
 * How long the outgoing position may stand still before the cut is forced; its
 * buffer running out is the normal end of a reaped generation.
 */
const HANDOVER_OUTGOING_STALL_MS = 400;
/**
 * How far ahead of the live position the join is placed, so the outgoing
 * element has not passed it when the seek completes. Not a safety margin: the
 * join loop waits for the position to arrive.
 */
const HANDOVER_JOIN_LEAD_MS = 400;
/** Below this much buffered media a second element cannot be ready before the picture stops. */
const HANDOVER_MINIMUM_RUNWAY_MS = 3_000;

/**
 * Playable media the replacement must hold beyond the join before promotion;
 * without it the promoted element starves seconds later. Waived once the
 * outgoing element has stopped.
 */
const HANDOVER_MINIMUM_INCOMING_AHEAD_MS = 5_000;

/** What the replacement's progress towards the join looks like over a span of wall clock. */
export interface HandoverJoinObservation {
  /** How far the join was beyond the replacement's buffered edge when the observation began. */
  startDeficitMs: number;
  /** The same distance now. */
  deficitMs: number;
  /** The wall-clock span those two readings are taken across. */
  observedMs: number;
  /** What is left of the budget for reaching the join. */
  remainingMs: number;
  /** Overridable only so a test can state its own window. */
  windowMs?: number;
}

/**
 * Whether the replacement has lost its race to the join, rather than not yet
 * won it. The join recedes at the viewer's rate while the replacement fills at
 * its node's rate; both are measured, never assumed from `source.mode` or a
 * constant playback rate. Answers `false` until a window has passed, since a
 * rate read inside one segment is quantisation.
 */
export function handoverJoinLost(observation: HandoverJoinObservation): boolean {
  const {
    startDeficitMs, deficitMs, observedMs, remainingMs,
    windowMs = HANDOVER_CONVERGENCE_WINDOW_MS,
  } = observation;
  if (observedMs < windowMs) return false;
  const closedMs = startDeficitMs - deficitMs;
  // A distance that is not shrinking outlasts any budget.
  if (closedMs <= 0) return true;
  return deficitMs / (closedMs / observedMs) > remainingMs;
}

/**
 * Where the teardown path attaches after an abandoned handover: the live
 * position in the replacement's clock (`clockOffsetMs` maps one onto the
 * other), and never behind core's request.
 */
export function handoverFallbackPositionMs(
  requestedMs: number,
  clockOffsetMs: number,
  livePositionMs: number,
): number {
  // Clamped to the generation's start: after a lead move core's request is negative.
  return Math.max(0, requestedMs, livePositionMs + clockOffsetMs);
}

/**
 * What the handover does with a join that may precede the incoming generation's
 * start. After a lead move the join is negative until the viewer reaches that
 * start; the wait must skip the convergence race, which would read it as a
 * receding join. A stalled outgoing picture ends the wait by cutting to the start.
 */
export function leadJoinStep(joinNewMs: number, outgoingStalled: boolean): 'wait' | 'join-at-start' | 'race' {
  if (joinNewMs >= 0) return 'race';
  return outgoingStalled ? 'join-at-start' : 'wait';
}

/** What the hold needs to know about the two sides of a relocation. */
export interface RelocationHoldSubject {
  /** As the resolver declared it, never sniffed from a URL. */
  incomingIsManifest: boolean;
  /** Whether hls.js drives the replacement, rather than the element itself. */
  managedHls: boolean;
  /** `readyState` of the element showing now, or `undefined` if there is none. */
  outgoingReadyState: number | undefined;
}

/** `HTMLMediaElement.HAVE_CURRENT_DATA`, usable without a DOM. */
const HAVE_CURRENT_DATA = 2;

/**
 * Whether the picture can be held while the replacement is built on a second
 * element. Depends on the replacement only: hls.js alone can load into an
 * element the viewer cannot see, whereas native HLS and plain URLs load in the
 * showing element. What the outgoing element plays is irrelevant.
 */
export function canHoldThroughRelocation(subject: RelocationHoldSubject): boolean {
  if (!subject.incomingIsManifest || !subject.managedHls) return false;
  // Nothing to hold without a frame up, which also declines a session's first generation.
  return (subject.outgoingReadyState ?? 0) >= HAVE_CURRENT_DATA;
}

/**
 * What a handover attempt leaves for the path that follows. `resumeAtMs` is the
 * viewer's position in the replacement's clock, present only when the attempt
 * took watched time; absent, core's request stands.
 */
type HandoverOutcome = { handedOver: true } | { handedOver: false; resumeAtMs?: number };

/** Declined before a second element existed: no time has passed. */
const DECLINED_HANDOVER: HandoverOutcome = { handedOver: false };

/** Resolve on a media element event, or `false` if it does not arrive in time. */
function waitForMediaEvent(video: HTMLVideoElement, name: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (value: boolean) => {
      if (timer !== undefined) clearTimeout(timer);
      video.removeEventListener(name, onEvent);
      resolve(value);
    };
    const onEvent = () => done(true);
    video.addEventListener(name, onEvent, { once: true });
    timer = setTimeout(() => done(false), timeoutMs);
  });
}

function nativeHlsSupported(video: HTMLVideoElement): boolean {
  return video.canPlayType('application/vnd.apple.mpegurl') !== '' || video.canPlayType('application/x-mpegURL') !== '';
}

export function shouldUseManagedHls(forceNativeHls: boolean | undefined, managedSupported: boolean): boolean {
  return forceNativeHls !== true && managedSupported;
}

export function webMediaElementFailure(error: Pick<MediaError, 'code' | 'message'> | null): PlaybackSourceError {
  const code = error?.code;
  const detail = error?.message ? `: ${error.message}` : '';
  if (code === 2) return new PlaybackSourceError(`Web media network failure${detail}`, 'stream', error);
  if (code === 3) return new PlaybackSourceError(`Web media decode failure${detail}`, 'media', error);
  if (code === 4) return new PlaybackSourceError(`Web media source is unsupported${detail}`, 'unsupported', error);
  return new PlaybackSourceError(`Web media playback failure${detail}`, 'unknown', error);
}

/** Web transport policy for source-local seeks that need no session mutation. */
export function webLocalSeekCoverage(
  source: PlaybackSource,
  bufferedRanges: readonly PlaybackTimeRange[],
): readonly PlaybackTimeRange[] {
  return source.mode === 'direct'
    ? [{ startMs: 0, endMs: Number.POSITIVE_INFINITY }]
    : bufferedRanges;
}

/**
 * Ranges in whole milliseconds, widened: core admits a local seek against a
 * whole-millisecond target, and narrowing would refuse a seek the element can
 * serve, costing a generation negotiation.
 */
export function wholeMillisecondRanges(ranges: PlaybackTimeRange[]): PlaybackTimeRange[] {
  return ranges.map((range) => ({
    startMs: Math.floor(range.startMs),
    endMs: Math.ceil(range.endMs),
  }));
}

/**
 * Playable media ahead of a position. Only a range covering the position
 * counts, since the element stops at a hole; a range starting up to 250 ms
 * ahead is allowed, as element and ranges disagree slightly. Position and
 * ranges must share a clock; which clock does not matter.
 */
export function forwardBufferMsAt(positionMs: number, ranges: PlaybackTimeRange[]): number {
  let forwardMs = 0;
  for (const range of ranges) {
    if (range.startMs <= positionMs + 250 && range.endMs >= positionMs) {
      forwardMs = Math.max(forwardMs, range.endMs - positionMs);
    }
  }
  return forwardMs;
}

/** Where a player asks for a Direct Play file's keyframe byte index. */
export type KeyframeSource = (mediaId: string) => Promise<KeyframeIndex | undefined>;

let keyframeSource: KeyframeSource | undefined;

/** Set by the app, which owns the catalogue; the platform exists before there is one. */
export function setKeyframeSource(source: KeyframeSource | undefined): void {
  keyframeSource = source;
}

/**
 * The element's real buffered ranges on Direct Play. Chrome's `video.buffered`
 * for a whole file is an estimate (`byte / size × duration`), so an uneven
 * bitrate reports media where there is none. This inverts that conversion with
 * the element's own duration and maps the bytes through the file's index.
 * Undefined when there is nothing to divide by.
 */
export function directPlayBufferedRanges(
  index: KeyframeIndex,
  estimated: readonly PlaybackTimeRange[],
  elementDurationMs: number,
): PlaybackTimeRange[] | undefined {
  if (!Number.isFinite(elementDurationMs) || elementDurationMs <= 0 || index.sizeBytes <= 0) return undefined;
  const byteAt = (ms: number) => ms / elementDurationMs * index.sizeBytes;
  return bufferedTimeRanges(index, estimated.map((range) => ({
    startByte: Math.floor(byteAt(range.startMs)),
    endByte: Math.ceil(byteAt(range.endMs)),
  })));
}

function playbackTimeRanges(rangesValue: TimeRanges): PlaybackTimeRange[] {
  const out: PlaybackTimeRange[] = [];
  for (let index = 0; index < rangesValue.length; index += 1) {
    out.push({
      startMs: rangesValue.start(index) * 1000,
      endMs: rangesValue.end(index) * 1000,
    });
  }
  return out;
}

let webPlayerSequence = 0;

export interface WebPlayerOptions {
  /** Disable the Web-only Service Worker read-ahead path for constrained runtimes. */
  directPlayReadAhead?: boolean;
  /** Chromium 47 compatibility: play() may not return a Promise. */
  legacyMediaElement?: boolean;
  /** Samsung TV: bypass Chromium's MIME probe and use the platform HLS path. */
  forceNativeHls?: boolean;
}

class WebPlayer implements Player {
  /**
   * Whether a lead move may hand this player a negative position. Only the
   * managed-HLS handover keeps the outgoing picture playing until the viewer
   * reaches a generation that starts ahead; native HLS would attach at its
   * start and skip the viewer forward by the lead.
   */
  get holdsThroughLead(): boolean {
    return shouldUseManagedHls(this.options.forceNativeHls, managedHlsSupported());
  }

  /**
   * Whether core must hold a source back until the node has produced media.
   * Native HLS only: it treats a `500 segment_not_ready` first fragment as a
   * permanent network failure, where hls.js retries.
   */
  get needsProducedSource(): boolean {
    return !shouldUseManagedHls(this.options.forceNativeHls, managedHlsSupported());
  }

  private host?: HTMLElement;
  private video?: HTMLVideoElement;
  private hls?: Hls;
  /**
   * A failed generation, stopped but not destroyed: `destroy()` detaches the
   * MediaSource and blacks the element, so it is released only once replaced.
   */
  private retiredHls?: Hls;
  private listeners = new Set<PlaybackListener>();
  private failureListeners = new Set<PlaybackFailureListener>();
  private degradationListeners = new Set<PlaybackDegradationListener>();
  private readonly playerId = ++webPlayerSequence;
  private readonly log = createClientLogger('playback.web', { playerId: this.playerId });
  private readonly diagnostics = new WebMediaDiagnostics(this.log);
  /** Each element's source buffers by track, while hls.js has them; for `WebMediaDiagnostics`. */
  private readonly trackBuffers = new WeakMap<HTMLVideoElement, Partial<Record<string, SourceBuffer>>>();
  /** One per element that is starting a source; see `armStartRecorder`. */
  private readonly startRecorders = new WeakMap<HTMLVideoElement, {
    recorder: StartRecorder;
    requests: () => PerformanceResourceTiming[] | undefined;
    cleanup: () => void;
  }>();
  private initialSeekCleanup?: () => void;
  private subtitleGeneration = 0;
  private subtitleCleanup?: () => void;
  private subtitleTextTrack?: TextTrack;
  private volume = 1;
  private directReadAheadSourceUrl?: string;
  private wantsPlayback = false;
  private playRequestGeneration = 0;
  private activeSource?: PlaybackSource;
  private sourceGeneration = 0;
  /**
   * The generation whose source the element holds, which lags
   * `sourceGeneration` while a native HLS source is awaited. The element's
   * `error` event carries no generation, so without this an error in that
   * window is charged to the incoming node.
   */
  private attachedSourceGeneration?: number;
  private failedSourceGeneration?: number;
  private degradedSourceGeneration?: number;
  /** Its own latch: see `degradeSourceNotFound` for why it is not the one above. */
  private notFoundSourceGeneration?: number;
  /** A generation reported gone on the failure channel: see `reportSourceGone`. */
  private goneReportedGeneration?: number;
  private unsubscribeDirectDegradation?: () => void;
  private hlsMediaRecovery?: ManagedHlsMediaRecoveryBudget;
  /** A managed-HLS load stopped by a fatal error raised while nobody was watching. */
  private hlsLoadParkedWhilePaused = false;
  private mediaTimeline?: WebMediaTimeline;
  /** The Direct Play file's byte index, once loaded; see `directPlayBufferedRanges`. */
  private keyframeIndex?: KeyframeIndex;
  /** A picture frozen at the control while a seek's destination is decided. */
  private pictureHold?: { resumeWanted: boolean };
  private lastPublishedEvent?: PlaybackEvent;
  private readonly startWatchdog = new MediaStartWatchdog(browserMediaWatchdogEnvironment);
  private readonly stallWatchdog = new MediaStallWatchdog(browserMediaWatchdogEnvironment);

  constructor(private readonly options: WebPlayerOptions = {}) {}

  attach(host: HTMLElement): void {
    this.host = host;
    const video = this.video;
    if (video && video.parentNode !== host) {
      while (host.firstChild) host.removeChild(host.firstChild);
      host.appendChild(video);
    }
    this.log.debug('attach');
  }

  detachHost(): void {
    this.log.debug('detach-host');
    this.host = undefined;
  }

  detach(): void {
    this.log.debug('detach');
    this.stop();
    this.host = undefined;
  }

  prepare(profile: MediaTechnicalProfile): void {
    const video = this.ensureMediaElement();
    const negotiatedMime = profile.negotiated?.mimeType;
    this.log.debug('media-prepared', {
      mediaId: profile.mediaId,
      format: profile.format,
      durationMs: profile.durationMs,
      bitrate: profile.bitrate,
      negotiatedMode: profile.negotiated?.mode,
      negotiatedMime,
      supported: negotiatedMime ? supportedMime(video, negotiatedMime) : undefined,
    });
  }

  private ensureMediaElement(): HTMLVideoElement {
    if (this.video) return this.video;
    const video = this.createWiredMediaElement();
    this.video = video;
    const host = this.host;
    if (host) {
      while (host.firstChild) host.removeChild(host.firstChild);
      host.appendChild(video);
    }
    return video;
  }

  /**
   * A fully wired media element, owned by nobody yet. Every listener guards on
   * `video !== this.video`, so an unpromoted element is inert; the handover's
   * safety rests on that.
   */
  private createWiredMediaElement(): HTMLVideoElement {
    const video = document.createElement('video');
    video.className = 'native-video';
    video.autoplay = true;
    video.controls = false;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.volume = this.volume;
    if (this.options.legacyMediaElement) {
      video.muted = false;
      video.defaultMuted = false;
      video.removeAttribute('muted');
      video.setAttribute('autoplay', 'autoplay');
      video.setAttribute('preload', 'auto');
    }
    this.diagnostics.attach(video, () => this.directReadAheadSourceUrl, () => this.trackBuffers.get(video));

    const publish = () => this.publish(video);
    video.addEventListener('timeupdate', publish);
    video.addEventListener('progress', publish);
    video.addEventListener('pause', publish);
    video.addEventListener('play', publish);
    video.addEventListener('playing', publish);
    video.addEventListener('waiting', publish);
    video.addEventListener('seeking', publish);
    video.addEventListener('seeked', publish);
    video.addEventListener('loadedmetadata', publish);
    video.addEventListener('loadeddata', publish);
    video.addEventListener('durationchange', publish);
    video.addEventListener('canplay', publish);
    video.addEventListener('emptied', publish);
    video.addEventListener('ended', publish);
    video.addEventListener('error', () => {
      // Teardown clears activeSource before removing src; those element events
      // are not a generation failure.
      if (!this.activeSource || video !== this.video) return;
      if (this.attachedSourceGeneration !== this.sourceGeneration) return;
      // The read-ahead worker hands a 404 body to the element as media, so the
      // element raises a generic decode or unsupported error with no status;
      // the worker's not-found report is what identifies a gone source.
      const generation = this.sourceGeneration;
      const judge = (status: number | undefined) => {
        if (generation !== this.sourceGeneration || video !== this.video || !this.activeSource) return;
        if (this.notFoundSourceGeneration === generation || isSourceGoneStatus(status)) {
          this.reportSourceGone(
            generation,
            new PlaybackSourceError('The node no longer has this source.', 'not-found', video.error),
            videoState(video),
          );
          return;
        }
        this.failSourceGeneration(generation, webMediaElementFailure(video.error), videoState(video));
      };
      // The worker's report can arrive after this error, so a read-ahead source
      // asks the worker for the node's status before the error is judged terminal.
      if (this.notFoundSourceGeneration === generation || !this.directReadAheadSourceUrl) {
        judge(undefined);
        return;
      }
      void directPlayReadAheadSourceStatus(this.directReadAheadSourceUrl).then(judge);
    });
    // Evidence that bytes reached the element, ending the start watchdog.
    // `progress` fires long before readyState leaves HAVE_NOTHING; the rest
    // cover an engine that reaches readiness without one.
    for (const name of ['progress', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'error'] as const) {
      video.addEventListener(name, () => this.startWatchdog.noteProgress());
    }
    const resumeWhenReady = () => {
      if (!this.wantsPlayback || !video.paused) return;
      this.requestPlay(video, 'media-ready');
    };
    // Chromium may reject a play() made before the element has a usable
    // source; readiness events retry it.
    video.addEventListener('loadedmetadata', resumeWhenReady);
    video.addEventListener('loadeddata', resumeWhenReady);
    video.addEventListener('canplay', resumeWhenReady);
    return video;
  }

  async play(
    source: PlaybackSource,
    positionMs = 0,
    startPaused = false,
    transition: PlaybackTransition = 'relocate',
  ): Promise<boolean> {
    if (!this.host) throw new Error('Player must be attached before playback');
    // A hidden handover only when the viewer did not ask to move: a requested
    // move would hold them on the old picture while the clock reads the
    // destination. `relocate` is the default and takes the teardown path.
    if (transition === 'continue') {
      const handover = await this.handOverToSource(source, positionMs, startPaused);
      if (handover.handedOver) return true;
      // The viewer kept watching through the attempt: attach where they are
      // now, or the fallback rewinds by however long it took.
      positionMs = handover.resumeAtMs ?? positionMs;
    }
    // A lead move's position is negative; nothing attaches before the
    // generation's first frame.
    positionMs = Math.max(0, positionMs);
    // The teardown path blanks the element (a new MediaSource URL resets it),
    // so hold the picture where possible. Tried on both transitions, and after
    // an abandoned handover too: `canHoldThroughRelocation()` decides.
    if (await this.holdThroughRelocation(source, positionMs, startPaused)) return true;
    const playRequestGeneration = ++this.playRequestGeneration;
    const sourceGeneration = ++this.sourceGeneration;
    this.failedSourceGeneration = undefined;
    this.degradedSourceGeneration = undefined;
    this.notFoundSourceGeneration = undefined;
    this.goneReportedGeneration = undefined;
    this.hlsLoadParkedWhilePaused = false;
    this.wantsPlayback = !startPaused;
    // Cleared first so teardown events from the previous source are ignored and
    // the new timeline learns no origin from the reused element's old buffer.
    this.activeSource = undefined;
    this.attachedSourceGeneration = undefined;
    this.mediaTimeline = undefined;
    this.keyframeIndex = undefined;
    this.lastPublishedEvent = undefined;
    this.log.info('source-load-begin', {
      mode: source.mode,
      mimeType: source.mimeType,
      mediaId: source.mediaId,
      url: source.url,
      subtitleUrl: source.subtitleUrl,
      requestedPositionMs: positionMs,
      hls: source.isManifest,
    });
    this.initialSeekCleanup?.();
    this.initialSeekCleanup = undefined;
    this.unsubscribeDirectDegradation?.();
    this.unsubscribeDirectDegradation = undefined;
    releaseDirectPlayReadAhead(this.directReadAheadSourceUrl);
    this.directReadAheadSourceUrl = undefined;
    this.hls?.destroy();
    this.hls = undefined;
    this.hlsMediaRecovery = undefined;
    // A failed generation's held picture goes too: this path blanks the element.
    this.destroyRetiredHls();
    this.startWatchdog.stop();
    this.stallWatchdog.stop();

    const existingVideo = this.video;
    const video = this.ensureMediaElement();
    if (existingVideo) {
      // The element is reused across generations: recreating it drops
      // element-scoped state such as fullscreen and PiP.
      video.pause();
      this.log.debug('media-element-reused');
    }

    this.activeSource = source;
    // `generation-start`: the loader fetches from the generation's beginning.
    // `positionMs` is the server's `seek_offset_ms` into it: where to seek to,
    // not where the media clock begins.
    this.mediaTimeline = new WebMediaTimeline(source.mode, positionMs, 'generation-start');

    const publish = () => this.publish(video);
    if (positionMs > 0) {
      const readinessEvents = ['loadedmetadata', 'loadeddata', 'canplay'] as const;
      const cleanupInitialSeek = () => {
        for (const name of readinessEvents) video.removeEventListener(name, initialSeek);
        if (this.initialSeekCleanup === cleanupInitialSeek) this.initialSeekCleanup = undefined;
      };
      const initialSeek = () => {
        if (playRequestGeneration !== this.playRequestGeneration || video !== this.video) {
          cleanupInitialSeek();
          return;
        }
        // publish() establishes the media-clock origin first: MSE may expose a
        // non-zero clock, so a source-local time never goes straight into currentTime.
        publish();
        const targetMediaMs = this.mediaTimeline?.toMediaTime(positionMs);
        if (targetMediaMs === undefined) return;
        this.log.info('initial-local-seek', {
          requestedPositionMs: positionMs,
          targetMediaMs,
          mediaOriginMs: this.mediaTimeline?.mediaOriginMs,
          before: videoState(video),
        });
        video.currentTime = targetMediaMs / 1000;
        cleanupInitialSeek();
        publish();
      };
      for (const name of readinessEvents) video.addEventListener(name, initialSeek);
      this.initialSeekCleanup = cleanupInitialSeek;
    }

    void this.applySubtitle(video, source.subtitleUrl).catch((error) => {
      this.log.warn('subtitle-initial-load-failed', { url: source.subtitleUrl, error: error instanceof Error ? error.message : String(error) });
    });

    // Whether the element itself fetches (a plain URL or native HLS). Only
    // then can a start starve silently; hls.js has its own bounded error channel.
    let elementOwnsFetch = false;
    this.armStartRecorder(video, source.url, 'primary');

    // Declared by the resolver, never sniffed: a native player handed an
    // undeclared .m3u8 parses the playlist as media and reports a source error.
    if (source.isManifest) {
      if (shouldUseManagedHls(this.options.forceNativeHls, managedHlsSupported())) {
        this.log.info('hls-js-selected', { url: source.url });
        // Usually already resolved: the capability probe warms it.
        const hlsModule = await loadHls();
        if (existingVideo) {
          // hls.js sets the element's source itself, so the previous
          // generation's must be reset explicitly.
          video.removeAttribute('src');
          video.load();
        }
        this.attachHls(hlsModule, video, source.url, sourceGeneration);
        this.attachedSourceGeneration = sourceGeneration;
      } else if (this.options.forceNativeHls || nativeHlsSupported(video)) {
        this.log.info('hls-native-selected', { url: source.url });
        // No removeAttribute('src')/load() reset, as on the direct path below.
        // No readiness wait either: `needsProducedSource` makes core hold the
        // source until media is produced.
        video.src = source.url;
        this.attachedSourceGeneration = sourceGeneration;
        elementOwnsFetch = true;
      } else {
        this.log.error('hls-unsupported', { url: source.url });
        throw new Error('This browser cannot play fragmented-MP4 HLS.');
      }
    } else {
      const directUrl = source.mode === 'direct' && this.options.directPlayReadAhead !== false
        ? directPlayReadAheadUrl(source)
        : source.url;
      if (directUrl !== source.url) {
        this.directReadAheadSourceUrl = source.url;
        this.unsubscribeDirectDegradation = subscribeDirectPlayReadAheadFailure(source.url, (error) => {
          // A 404 (no record of this source) or 410 (generation superseded)
          // is not evidence against the node, so it must not arrive as `stream`.
          if (isSourceGoneStatus(error.status)) {
            this.degradeSourceNotFound(
              sourceGeneration,
              new PlaybackSourceError(error.message, 'not-found', error),
              { sourceUrl: source.url, status: error.status },
            );
            return;
          }
          this.degradeSourceGeneration(
            sourceGeneration,
            new PlaybackSourceError(error.message, 'stream', error),
            { sourceUrl: source.url },
          );
        });
        setDirectPlayReadAheadMode(this.directReadAheadSourceUrl, 'bootstrap');
      }
      this.log.info('direct-source-selected', {
        url: source.url,
        mimeType: source.mimeType,
        readAhead: directUrl !== source.url,
      });
      // No removeAttribute('src')/load() before this: assigning src already
      // supersedes the previous load, and doing both in one tick can leave the
      // element at readyState 0 forever while the read-ahead Service Worker
      // controls the page.
      video.src = directUrl;
      this.attachedSourceGeneration = sourceGeneration;
      elementOwnsFetch = true;
      if (source.mode === 'direct') this.loadKeyframeIndex(video, source, sourceGeneration);
    }

    if (sourceGeneration !== this.sourceGeneration || this.failedSourceGeneration === sourceGeneration) return false;
    if (elementOwnsFetch) this.watchForStarvedStart(video, source, sourceGeneration);
    this.watchForStall(video, source, sourceGeneration);
    const playStarted = performance.now();
    if (startPaused) {
      setDirectPlayReadAheadMode(this.directReadAheadSourceUrl, 'paused');
      video.pause();
      this.log.info('source-attached-paused', {
        elapsedMs: Math.round((performance.now() - playStarted) * 10) / 10,
        state: videoState(video),
      });
    } else {
      this.requestPlay(video, 'source-attached', playRequestGeneration);
    }
    this.log.info('source-load-dispatched', {
      elapsedMs: Math.round((performance.now() - playStarted) * 10) / 10,
      startPaused,
      state: videoState(video),
    });
    return true;
  }

  /**
   * Replaces the playing generation without interrupting the picture: the
   * replacement is prepared on a second, hidden element and promoted once
   * buffered and aligned.
   *
   * A second element because `loadSource()` on a live hls.js instance empties
   * the element, and two generations cannot share a SourceBuffer.
   *
   * Alignment must be exact: the clock offset between the generations is taken
   * at the request, a join is chosen just ahead of the live position, the
   * hidden replacement seeks there, and the swap happens when the outgoing
   * element reaches it. Promoting at the replacement's own start would replay
   * the time spent buffering.
   *
   * `display: none` does not gate MSE buffering. A backgrounded tab stops
   * decoding, and that case is not handled.
   */
  private async handOverToSource(
    source: PlaybackSource,
    positionMs: number,
    startPaused: boolean,
  ): Promise<HandoverOutcome> {
    const outgoing = this.video;
    const host = this.host;
    const outgoingEvent = this.lastPublishedEvent;
    if (!host || !outgoing || !outgoingEvent || startPaused) return DECLINED_HANDOVER;
    // Only a generation that is actually playing has media to protect.
    if (outgoing.paused || !this.wantsPlayback || !this.activeSource) return DECLINED_HANDOVER;
    // Both sides must be managed HLS: native HLS owns its element source, and
    // Direct Play fails over inside the worker.
    if (!source.isManifest || !this.activeSource.isManifest) return DECLINED_HANDOVER;
    if (!shouldUseManagedHls(this.options.forceNativeHls, managedHlsSupported())) return DECLINED_HANDOVER;
    // Runway is read from the element, not from `outgoingEvent`: that sample's
    // age is unbounded and can only overestimate a stopped element's runway.
    // The clock offset below must use `outgoingEvent`, because core computed
    // its request from that sample.
    const runwayMs = forwardBufferMsAt(outgoing.currentTime * 1000, playbackTimeRanges(outgoing.buffered));
    if (runwayMs < HANDOVER_MINIMUM_RUNWAY_MS) return DECLINED_HANDOVER;

    const sourceGeneration = this.sourceGeneration + 1;
    const startedAt = performance.now();
    // The clocks differ by a fixed amount: `outgoingEvent.positionMs` on the
    // old one denotes the same content as `positionMs` on the new.
    const clockOffsetMs = positionMs - outgoingEvent.positionMs;
    // How far ahead of the viewer this generation starts, when core led it.
    const leadMs = positionMs < 0 ? -positionMs : 0;
    this.log.info('handover-begin', {
      url: source.url,
      leadMs,
      requestedPositionMs: positionMs,
      outgoingPositionMs: outgoingEvent.positionMs,
      clockOffsetMs,
      runwayMs,
    });

    const livePositionMs = () => (this.lastPublishedEvent?.positionMs ?? outgoingEvent.positionMs);

    let incoming: HTMLVideoElement | undefined;
    let built: { hls: InstanceType<typeof import('hls.js').default>; recovery: ManagedHlsMediaRecoveryBudget } | undefined;
    const abandon = (reason: string, detail?: unknown): HandoverOutcome => {
      // The viewer's position in the replacement's clock, so the teardown path
      // attaches where they are. Withheld once the element is no longer ours:
      // the offset does not describe whatever superseded it.
      const resumeAtMs = this.video === outgoing
        ? handoverFallbackPositionMs(positionMs, clockOffsetMs, livePositionMs())
        : undefined;
      this.log.warn('handover-abandoned', {
        reason,
        detail,
        elapsedMs: Math.round(performance.now() - startedAt),
        resumeAtMs,
      });
      if (incoming) this.finishStartRecorder(incoming, 'abandoned');
      try { built?.hls.destroy(); } catch { /* the fallback path rebuilds regardless */ }
      try { incoming?.remove(); } catch { /* already detached */ }
      return { handedOver: false, resumeAtMs };
    };

    try {
      const hlsModule = await loadHls();
      if (this.video !== outgoing) return abandon('superseded-while-loading-hls');
      incoming = this.createWiredMediaElement();
      incoming.style.display = 'none';
      incoming.muted = true;
      host.appendChild(incoming);
      this.armStartRecorder(incoming, source.url, 'handover');
      // Roughly where the cut will land; a starting hint only, the
      // buffered-join loop decides.
      const expectedJoinMs = Math.max(0, positionMs + HANDOVER_JOIN_LEAD_MS);
      built = this.attachHls(hlsModule, incoming, source.url, sourceGeneration, false, expectedJoinMs);

      // A led generation may take its whole lead to become ready; the viewer
      // is still watching the outgoing picture.
      const ready = await waitForMediaEvent(incoming, 'canplay', Math.max(HANDOVER_READY_TIMEOUT_MS, leadMs));
      if (!ready) return abandon('not-ready-in-time');
      if (this.video !== outgoing) return abandon('superseded-while-preparing');

      // The loader starts at the join, so the first resident fragment is not
      // the generation origin: the timeline is told the start position and
      // resolves the origin from it (hls.js puts `currentTime` at `startPosition`).
      const timeline = new WebMediaTimeline(source.mode, expectedJoinMs, 'requested-position');
      const sampled = timeline.sample({
        positionMs: incoming.currentTime * 1000,
        bufferedRangesMs: playbackTimeRanges(incoming.buffered),
        seekableRangesMs: playbackTimeRanges(incoming.seekable),
      });
      if (!sampled || !timeline.established) return abandon('incoming-timeline-unestablished');

      // Wait for the join to be buffered before seeking: `canplay` means only
      // that the first fragment arrived, and a seek into unbuffered media never
      // fires `seeked`. The join is recomputed each turn because the outgoing
      // element keeps moving.
      let joinAtOldMs = 0;
      let targetMediaMs: number | undefined;
      let bufferDeadline = performance.now() + HANDOVER_BUFFER_TIMEOUT_MS;
      let bufferLastSeenMs = livePositionMs();
      let bufferLastAdvancedAt = performance.now();
      // Where the race stood on its first turn, so convergence is measured.
      let convergenceStartedAt: number | undefined;
      let convergenceStartDeficitMs = 0;
      for (;;) {
        if (this.video !== outgoing) return abandon('superseded-while-buffering');
        if (outgoing.paused) return abandon('outgoing-paused-while-buffering');
        joinAtOldMs = livePositionMs() + HANDOVER_JOIN_LEAD_MS;
        const leadStep = leadJoinStep(
          joinAtOldMs + clockOffsetMs,
          performance.now() - bufferLastAdvancedAt > HANDOVER_OUTGOING_STALL_MS,
        );
        if (leadStep === 'wait') {
          // The viewer has not reached the generation: no race and no budget
          // runs until the join enters it.
          const nowMs = livePositionMs();
          if (nowMs > bufferLastSeenMs + 1) {
            bufferLastSeenMs = nowMs;
            bufferLastAdvancedAt = performance.now();
          }
          convergenceStartedAt = undefined;
          bufferDeadline = performance.now() + HANDOVER_BUFFER_TIMEOUT_MS;
          await new Promise((resolve) => setTimeout(resolve, HANDOVER_BUFFER_POLL_MS));
          continue;
        }
        if (leadStep === 'join-at-start') {
          this.log.warn('handover-lead-join-forced-by-stall', { joinAtOldMs, clockOffsetMs });
          joinAtOldMs = -clockOffsetMs;
        }
        targetMediaMs = timeline.toMediaTime(joinAtOldMs + clockOffsetMs);
        if (targetMediaMs === undefined) return abandon('incoming-join-unmappable');
        const targetSeconds = targetMediaMs / 1000;
        const resident = playbackTimeRanges(incoming.buffered)
          .some((range) => range.startMs <= targetMediaMs! && range.endMs >= targetMediaMs!);
        // Resident is not enough: see `HANDOVER_MINIMUM_INCOMING_AHEAD_MS`.
        const aheadOfJoinMs = playbackTimeRanges(incoming.buffered)
          .filter((range) => range.startMs <= targetMediaMs! && range.endMs >= targetMediaMs!)
          .reduce((ahead, range) => Math.max(ahead, range.endMs - targetMediaMs!), 0);
        // The margin is waived once the outgoing element has stopped.
        const nowMs = livePositionMs();
        if (nowMs > bufferLastSeenMs + 1) {
          bufferLastSeenMs = nowMs;
          bufferLastAdvancedAt = performance.now();
        }
        const outgoingStalled = performance.now() - bufferLastAdvancedAt > HANDOVER_OUTGOING_STALL_MS;
        if (resident && (aheadOfJoinMs >= HANDOVER_MINIMUM_INCOMING_AHEAD_MS || outgoingStalled)) {
          this.log.info('handover-join-buffered', {
            aheadOfJoinMs,
            elapsedMs: Math.round(performance.now() - startedAt),
            joinAtOldMs,
            targetSeconds,
            runwayMs: this.lastPublishedEvent?.forwardBufferMs,
          });
          break;
        }
        if (performance.now() > bufferDeadline) {
          return abandon('join-never-buffered', { targetSeconds, buffered: playbackTimeRanges(incoming.buffered) });
        }
        // Give up as soon as the race is decided: past that, the budget only
        // delays the fallback.
        const bufferedEndMs = playbackTimeRanges(incoming.buffered)
          .reduce((end, range) => Math.max(end, range.endMs), 0);
        const deficitMs = targetMediaMs - bufferedEndMs;
        if (convergenceStartedAt === undefined) {
          convergenceStartedAt = performance.now();
          convergenceStartDeficitMs = deficitMs;
        }
        const observedMs = performance.now() - convergenceStartedAt;
        // Only while the join is out of reach: a replacement holding the join
        // but short of the margin can still be promoted.
        if (!resident && handoverJoinLost({
          startDeficitMs: convergenceStartDeficitMs,
          deficitMs,
          observedMs,
          remainingMs: bufferDeadline - performance.now(),
        })) {
          return abandon('join-receding-faster-than-it-fills', {
            targetSeconds,
            bufferedEndMs,
            deficitMs: Math.round(deficitMs),
            startDeficitMs: Math.round(convergenceStartDeficitMs),
            observedMs: Math.round(observedMs),
          });
        }
        await new Promise((resolve) => setTimeout(resolve, HANDOVER_BUFFER_POLL_MS));
      }

      incoming.currentTime = targetMediaMs / 1000;
      if (!await waitForMediaEvent(incoming, 'seeked', HANDOVER_SEEK_TIMEOUT_MS)) return abandon('incoming-seek-timeout');
      if (this.video !== outgoing) return abandon('superseded-while-seeking');
      this.log.info('handover-aligned', {
        elapsedMs: Math.round(performance.now() - startedAt),
        runwayMs: this.lastPublishedEvent?.forwardBufferMs,
      });

      // Wait for the outgoing element to reach the join, so the cut is where it
      // was planned. A stalled outgoing element (its source gone, its buffer
      // spent) ends the wait, and the cut happens where it stopped.
      const deadline = performance.now() + HANDOVER_JOIN_TIMEOUT_MS;
      let lastSeenMs = livePositionMs();
      let lastAdvancedAt = performance.now();
      while (livePositionMs() < joinAtOldMs) {
        if (performance.now() > deadline) return abandon('join-point-never-reached', { joinAtOldMs, at: livePositionMs() });
        if (this.video !== outgoing) return abandon('superseded-while-waiting-for-join');
        if (outgoing.paused) return abandon('outgoing-paused-before-join');
        const now = livePositionMs();
        if (now > lastSeenMs + 1) {
          lastSeenMs = now;
          lastAdvancedAt = performance.now();
        } else if (performance.now() - lastAdvancedAt > HANDOVER_OUTGOING_STALL_MS) {
          this.log.warn('handover-join-forced-by-stall', { joinAtOldMs, stalledAtMs: now });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, HANDOVER_JOIN_POLL_MS));
      }

      this.promoteHandover(source, incoming, built, timeline, sourceGeneration, outgoing);
      this.log.info('handover-complete', {
        elapsedMs: Math.round(performance.now() - startedAt),
        joinAtOldMs,
        joinAtNewMs: joinAtOldMs + clockOffsetMs,
        landedAtMs: this.lastPublishedEvent?.positionMs,
      });
      return { handedOver: true };
    } catch (error) {
      return abandon('threw', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Pauses on the last frame through a relocation instead of blanking the
   * element, which would show black for as long as the node takes.
   *
   * The replacement is prepared on a second element while the outgoing one
   * stays paused. Unlike the handover, the outgoing generation is not played:
   * the viewer would watch the old scene while the clock read the destination.
   *
   * The replacement loads from the generation's start and then seeks to the
   * offset, as the teardown path does; a `startPosition` would move the media
   * clock's origin.
   *
   * Declines what it cannot do cleanly, and the caller falls through to the
   * teardown path.
   */
  private async holdThroughRelocation(source: PlaybackSource, positionMs: number, startPaused: boolean): Promise<boolean> {
    const outgoing = this.video;
    const host = this.host;
    if (!host || !outgoing || !this.activeSource) return false;
    if (!canHoldThroughRelocation({
      incomingIsManifest: source.isManifest,
      managedHls: shouldUseManagedHls(this.options.forceNativeHls, managedHlsSupported()),
      outgoingReadyState: outgoing.readyState,
    })) return false;

    // Usually already frozen by the control; taken here for relocations no
    // control asked for (a failover, a mode switch). `wantsPlayback` goes with
    // it so no readiness event restarts the outgoing element.
    const restoreIntent = this.pictureHold?.resumeWanted ?? this.wantsPlayback;
    this.pictureHold = { resumeWanted: restoreIntent };
    outgoing.pause();
    this.wantsPlayback = false;
    // A picture frozen on purpose reads to the stall watchdog like a dead
    // node. Core re-arms it on the first report after playback advances.
    this.stallWatchdog.suspend();
    this.publish(outgoing);

    const sourceGeneration = this.sourceGeneration + 1;
    const startedAt = performance.now();
    this.log.info('relocation-hold-begin', {
      url: source.url,
      requestedPositionMs: positionMs,
      heldAtMs: this.lastPublishedEvent?.positionMs,
    });

    let incoming: HTMLVideoElement | undefined;
    let built: { hls: InstanceType<typeof import('hls.js').default>; recovery: ManagedHlsMediaRecoveryBudget } | undefined;
    const abandon = (reason: string, detail?: unknown) => {
      this.log.warn('relocation-hold-abandoned', { reason, detail, elapsedMs: Math.round(performance.now() - startedAt) });
      if (incoming) this.finishStartRecorder(incoming, 'abandoned');
      try { built?.hls.destroy(); } catch { /* the fallback path rebuilds regardless */ }
      try { incoming?.remove(); } catch { /* already detached */ }
      this.pictureHold = undefined;
      this.wantsPlayback = restoreIntent;
      return false;
    };

    try {
      const hlsModule = await loadHls();
      if (this.video !== outgoing) return abandon('superseded-while-loading-hls');
      incoming = this.createWiredMediaElement();
      incoming.style.display = 'none';
      incoming.muted = true;
      host.appendChild(incoming);
      this.armStartRecorder(incoming, source.url, 'relocation');
      built = this.attachHls(hlsModule, incoming, source.url, sourceGeneration, false);

      if (!await waitForMediaEvent(incoming, 'canplay', HANDOVER_READY_TIMEOUT_MS)) return abandon('not-ready-in-time');
      if (this.video !== outgoing) return abandon('superseded-while-preparing');

      // As on the teardown path: the loader began at the generation's start,
      // so the first resident timestamp is the origin.
      const timeline = new WebMediaTimeline(source.mode, positionMs, 'generation-start');
      const sampled = timeline.sample({
        positionMs: incoming.currentTime * 1000,
        bufferedRangesMs: playbackTimeRanges(incoming.buffered),
        seekableRangesMs: playbackTimeRanges(incoming.seekable),
      });
      if (!sampled || !timeline.established) return abandon('incoming-timeline-unestablished');

      const targetMediaMs = timeline.toMediaTime(positionMs);
      if (targetMediaMs === undefined) return abandon('incoming-target-unmappable');
      if (Math.abs(incoming.currentTime * 1000 - targetMediaMs) > 250) {
        incoming.currentTime = targetMediaMs / 1000;
        if (!await waitForMediaEvent(incoming, 'seeked', HANDOVER_SEEK_TIMEOUT_MS)) return abandon('incoming-seek-timeout');
        if (this.video !== outgoing) return abandon('superseded-while-seeking');
      }

      this.promoteHandover(source, incoming, built, timeline, sourceGeneration, outgoing, startPaused);
      this.log.info('relocation-hold-complete', {
        elapsedMs: Math.round(performance.now() - startedAt),
        requestedPositionMs: positionMs,
        landedAtMs: this.lastPublishedEvent?.positionMs,
        startPaused,
      });
      return true;
    } catch (error) {
      return abandon('threw', error instanceof Error ? error.message : String(error));
    }
  }

  /** The cut itself: one synchronous block, so nothing can be seen half-done. */
  private promoteHandover(
    source: PlaybackSource,
    incoming: HTMLVideoElement,
    built: { hls: InstanceType<typeof import('hls.js').default>; recovery: ManagedHlsMediaRecoveryBudget },
    timeline: WebMediaTimeline,
    sourceGeneration: number,
    outgoing: HTMLVideoElement,
    /** A relocation may promote into a paused player; a handover never does. */
    startPaused = false,
  ): void {
    const outgoingHls = this.hls;
    // Mute the outgoing element first, so the join is never two soundtracks.
    outgoing.muted = true;
    incoming.style.display = '';
    incoming.muted = false;
    incoming.volume = this.volume;

    this.playRequestGeneration += 1;
    this.sourceGeneration = sourceGeneration;
    this.attachedSourceGeneration = sourceGeneration;
    this.failedSourceGeneration = undefined;
    this.degradedSourceGeneration = undefined;
    this.notFoundSourceGeneration = undefined;
    this.goneReportedGeneration = undefined;
    this.hlsLoadParkedWhilePaused = false;
    this.initialSeekCleanup?.();
    this.initialSeekCleanup = undefined;
    this.unsubscribeDirectDegradation?.();
    this.unsubscribeDirectDegradation = undefined;
    this.activeSource = source;
    this.mediaTimeline = timeline;
    this.lastPublishedEvent = undefined;
    this.video = incoming;
    this.hls = built.hls;
    this.hlsMediaRecovery = built.recovery;
    // The replacement is up, so any picture hold is spent.
    this.pictureHold = undefined;
    this.wantsPlayback = !startPaused;

    if (startPaused) incoming.pause();
    else void incoming.play().catch((error) => this.log.warn('handover-play-rejected', { error }));
    outgoing.pause();

    this.startWatchdog.stop();
    this.stallWatchdog.stop();
    this.watchForStall(incoming, source, sourceGeneration);
    void this.applySubtitle(incoming, source.subtitleUrl).catch((error) => {
      this.log.warn('subtitle-initial-load-failed', { url: source.subtitleUrl, error: error instanceof Error ? error.message : String(error) });
    });

    // Released after the cut, never before it; likewise a failed generation
    // kept alive to hold the picture.
    try { outgoingHls?.destroy(); } catch { /* the element is going anyway */ }
    this.destroyRetiredHls();
    outgoing.removeAttribute('src');
    outgoing.load();
    outgoing.remove();
    // A Direct Play outgoing side (a mode switch) leaves a read-ahead that the
    // worker would otherwise go on fetching.
    releaseDirectPlayReadAhead(this.directReadAheadSourceUrl);
    this.directReadAheadSourceUrl = undefined;
    this.publish(incoming);
  }

  async setSubtitle(subtitleUrl?: string): Promise<void> {
    const video = this.video;
    if (!video) throw new Error('Player has no active media element');
    this.log.info('subtitle-source-update', { url: subtitleUrl ?? 'off' });
    await this.applySubtitle(video, subtitleUrl);
  }

  addDirectSourceAlternative(activeSource: PlaybackSource, alternative: PlaybackSource): boolean {
    return addDirectPlayReadAheadAlternative(activeSource, alternative);
  }

  preflightSource(source: PlaybackSource): Promise<boolean> {
    return preflightWebHlsSource(source);
  }

  private clearSubtitleTracks(video: HTMLVideoElement): number {
    const generation = ++this.subtitleGeneration;
    this.subtitleCleanup?.();
    this.subtitleCleanup = undefined;
    video.querySelectorAll('track[data-macha-subtitle]').forEach((track) => track.parentNode?.removeChild(track));
    if (this.subtitleTextTrack) clearTextTrackCues(this.subtitleTextTrack);
    return generation;
  }

  private loadSubtitleTrack(video: HTMLVideoElement, url: string, generation: number): Promise<void> {
    const track = document.createElement('track');
    track.dataset.machaSubtitle = 'true';
    track.kind = 'subtitles';
    track.label = 'Selected subtitles';
    track.srclang = 'und';
    track.src = url;
    return new Promise<void>((resolve, reject) => {
      track.addEventListener('load', () => {
        if (generation !== this.subtitleGeneration) {
          track.remove();
          resolve();
          return;
        }
        track.track.mode = 'showing';
        this.log.debug('subtitle-loaded', { url });
        resolve();
      }, { once: true });
      track.addEventListener('error', () => {
        track.remove();
        this.log.warn('subtitle-error', { url });
        reject(new Error('Selected subtitles could not be loaded.'));
      }, { once: true });
      video.appendChild(track);
      // A disabled TextTrack need not fetch: hidden loads it, and the load
      // handler shows it once parsed.
      track.track.mode = 'hidden';
    });
  }

  private subtitleDisplayTrack(video: HTMLVideoElement): TextTrack {
    if (!this.subtitleTextTrack) {
      this.subtitleTextTrack = video.addTextTrack('subtitles', 'Selected subtitles', 'und');
    }
    clearTextTrackCues(this.subtitleTextTrack);
    this.subtitleTextTrack.mode = 'showing';
    return this.subtitleTextTrack;
  }

  private async applySegmentedSubtitle(
    video: HTMLVideoElement,
    manifestUrl: string,
    manifest: SubtitleSegmentManifest,
    generation: number,
  ): Promise<void> {
    const starts = subtitleSegmentStarts(manifest.segment_durations_ms);
    const segmentAt = (positionMs: number): number => subtitleSegmentAt(starts, positionMs);

    const displayTrack = this.subtitleDisplayTrack(video);
    const segmentCues = new Map<number, TextTrackCue[]>();
    const loading = new Map<number, Promise<void>>();
    const wanted = new Set<number>();
    const segmentUrl = (index: number) => new URL(`segment-${index}.vtt`, manifestUrl).toString();

    const unload = (index: number): void => {
      const cues = segmentCues.get(index);
      if (!cues) return;
      // Keep the display track active while its cue list is edited.
      displayTrack.mode = 'showing';
      for (const cue of cues) {
        try {
          displayTrack.removeCue(cue);
        } catch {
          // A cancelled generation may already have cleared this cue.
        }
      }
      segmentCues.delete(index);
    };

    const parseSegment = (index: number, text: string): Promise<TextTrackCue[]> => new Promise((resolve, reject) => {
      const parser = document.createElement('track');
      // Not marked as an active subtitle track: a concurrent selection clears
      // those, and this parser must finish so its promise settles.
      parser.dataset.machaSubtitleParser = String(index);
      parser.kind = 'subtitles';
      parser.label = `Subtitle parser ${index}`;
      parser.srclang = 'und';
      const blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
      parser.src = blobUrl;

      const finish = () => {
        parser.remove();
        URL.revokeObjectURL(blobUrl);
      };
      parser.addEventListener('load', () => {
        const parsed: TextTrackCue[] = [];
        const cues = parser.track.cues;
        if (cues) {
          for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
            const cue = cues[cueIndex];
            if (!cue) continue;
            const clone = cloneWebVttCue(cue);
            if (clone) parsed.push(clone);
          }
        }
        finish();
        resolve(parsed);
      }, { once: true });
      parser.addEventListener('error', () => {
        finish();
        reject(new Error('Browser could not parse a subtitle segment.'));
      }, { once: true });
      video.appendChild(parser);
      // Hidden runs the WebVTT parser without rendering; the cues are copied
      // into the display track.
      parser.track.mode = 'hidden';
    });

    const load = (index: number): Promise<void> => {
      if (index < 0 || index >= starts.length || generation !== this.subtitleGeneration) return Promise.resolve();
      if (segmentCues.has(index)) return Promise.resolve();
      const existing = loading.get(index);
      if (existing) return existing;

      const url = segmentUrl(index);
      const promise = (async () => {
        let response: Response;
        try {
          response = await fetch(url, { headers: { Accept: 'text/vtt' } });
        } catch (error) {
          this.log.warn('subtitle-segment-fetch-failed', { index, url, error });
          throw new Error('Selected subtitles could not be loaded.');
        }
        if (!response.ok) {
          this.log.warn('subtitle-segment-http-error', { index, url, status: response.status });
          throw new Error(`Selected subtitles could not be loaded (${response.status}).`);
        }
        const text = await response.text();
        if (generation !== this.subtitleGeneration || !wanted.has(index)) return;

        let cues: TextTrackCue[];
        try {
          cues = await parseSegment(index, text);
        } catch (error) {
          this.log.warn('subtitle-segment-parse-error', { index, url, error });
          throw new Error('Selected subtitles could not be loaded.');
        }
        if (generation !== this.subtitleGeneration || !wanted.has(index)) return;

        for (const cue of cues) displayTrack.addCue(cue);
        segmentCues.set(index, cues);
        this.log.debug('subtitle-segment-loaded', { index, url, cues: cues.length });
      })().finally(() => {
        loading.delete(index);
      });
      loading.set(index, promise);
      return promise;
    };

    const refresh = () => {
      if (generation !== this.subtitleGeneration) return;
      const current = segmentAt(video.currentTime * 1000);
      wanted.clear();
      // The window keeps the preceding segment, for a cue that crosses the
      // boundary, and prefetches the next.
      for (const index of subtitleSegmentWindow(current, starts.length)) {
        wanted.add(index);
        void load(index).catch(() => undefined);
      }
      for (const index of [...segmentCues.keys()]) {
        if (!wanted.has(index)) unload(index);
      }
    };

    const events = ['loadedmetadata', 'timeupdate', 'seeking', 'seeked'] as const;
    for (const event of events) video.addEventListener(event, refresh);
    this.subtitleCleanup = () => {
      for (const event of events) video.removeEventListener(event, refresh);
      wanted.clear();
      for (const index of [...segmentCues.keys()]) unload(index);
      loading.clear();
      clearTextTrackCues(displayTrack);
    };

    // Prime the window, then await the current segment; repeat once if
    // playback moved meanwhile.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      refresh();
      const current = segmentAt(video.currentTime * 1000);
      await load(current);
      if (generation !== this.subtitleGeneration) return;
      if (segmentAt(video.currentTime * 1000) === current) break;
    }
    refresh();
  }

  private async applySubtitle(video: HTMLVideoElement, subtitleUrl?: string): Promise<void> {
    const generation = this.clearSubtitleTracks(video);
    if (!subtitleUrl) return;

    // A monolithic VTT rather than a segment manifest gets a plain track.
    if (isLegacyWebVtt(subtitleUrl)) {
      await this.loadSubtitleTrack(video, subtitleUrl, generation);
      return;
    }

    let response: Response;
    try {
      response = await fetch(subtitleUrl, { headers: { Accept: 'application/json' } });
    } catch (error) {
      this.log.warn('subtitle-manifest-fetch-failed', { url: subtitleUrl, error });
      throw new Error('Selected subtitles could not be loaded.');
    }
    if (!response.ok) {
      this.log.warn('subtitle-manifest-http-error', { url: subtitleUrl, status: response.status });
      throw new Error(`Selected subtitles could not be loaded (${response.status}).`);
    }

    let manifest: unknown;
    try {
      manifest = await response.json() as unknown;
    } catch (error) {
      this.log.warn('subtitle-manifest-json-error', { url: subtitleUrl, error });
      throw new Error('Server returned an invalid subtitle manifest.');
    }
    if (!validSubtitleManifest(manifest)) {
      this.log.warn('subtitle-manifest-invalid', { url: subtitleUrl, manifest });
      throw new Error('Server returned an invalid subtitle manifest.');
    }
    if (generation !== this.subtitleGeneration) return;
    this.log.debug('subtitle-manifest-loaded', {
      url: subtitleUrl,
      streamIndex: manifest.stream_index,
      segments: manifest.segment_durations_ms.length,
    });
    await this.applySegmentedSubtitle(video, subtitleUrl, manifest, generation);
  }

  pause(): void {
    this.playRequestGeneration += 1;
    this.log.info('pause-request', this.video ? videoState(this.video) : undefined);
    this.wantsPlayback = false;
    setDirectPlayReadAheadMode(this.directReadAheadSourceUrl, 'paused');
    // Paused is not stalled: the stall countdown is suspended, not switched
    // off. Core re-arms it on the first report after the resume.
    this.stallWatchdog.suspend();
    // Pause is presentation intent, not teardown: managed HLS and the Direct
    // Play worker keep filling their bounded buffers.
    this.video?.pause();
  }

  resume(): void {
    this.playRequestGeneration += 1;
    const video = this.video;
    if (!video) {
      this.wantsPlayback = true;
      this.log.debug('resume-intent-before-media');
      return;
    }
    this.log.info('resume-request', videoState(video));
    this.wantsPlayback = true;
    this.restartParkedHlsLoad(video);
    this.requestPlay(video, 'resume');
  }

  /**
   * Restarts a managed-HLS load that a pause parked. Called before
   * `requestPlay`, so whatever killed the load is met again while the viewer
   * is waiting.
   */
  private restartParkedHlsLoad(video: HTMLVideoElement): void {
    if (!this.hlsLoadParkedWhilePaused) return;
    this.hlsLoadParkedWhilePaused = false;
    const hls = this.hls;
    if (!hls) return;
    this.log.warn('hls-load-restarted-after-pause', videoState(video));
    hls.startLoad(video.currentTime);
  }

  private requestPlay(video: HTMLVideoElement, reason: string, expectedGeneration = this.playRequestGeneration): void {
    if (!this.wantsPlayback || expectedGeneration !== this.playRequestGeneration || video !== this.video) return;
    try {
      const result = video.play() as Promise<void> | undefined;
      if (!result || typeof result.then !== 'function') {
        this.log.debug('play-requested-legacy', { reason, state: videoState(video) });
        return;
      }
      void result.then(() => {
        if (!this.wantsPlayback || expectedGeneration !== this.playRequestGeneration || video !== this.video) return;
        this.log.info(reason === 'resume' ? 'resume-started' : 'autoplay-started', { reason, state: videoState(video) });
      }).catch((error) => {
        if (!this.wantsPlayback || expectedGeneration !== this.playRequestGeneration || video !== this.video) {
          this.log.debug('play-superseded-by-control', { reason, error, state: videoState(video) });
          return;
        }
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          this.log.warn('autoplay-blocked', { reason, error, state: videoState(video) });
          return;
        }
        // AbortError: another media operation superseded play().
        // NotSupportedError or HAVE_NOTHING: hls.js has not attached its
        // MediaSource yet, and the readiness events retry.
        if ((error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotSupportedError'))
            || video.readyState === HTMLMediaElement.HAVE_NOTHING) {
          this.log.debug('play-deferred-until-media-ready', { reason, error, state: videoState(video) });
          return;
        }
        this.log.warn('play-request-failed', { reason, error, state: videoState(video) });
      });
    } catch (error) {
      if (!this.wantsPlayback || expectedGeneration !== this.playRequestGeneration || video !== this.video) return;
      this.log.debug('play-request-threw-before-media-ready', { reason, error, state: videoState(video) });
    }
  }

  /**
   * Freezes the picture the instant a seek is asked for. The player first
   * hears of a relocation at `play()`, after the node has answered; until then
   * the outgoing generation would play a scene the viewer has left.
   *
   * Taken optimistically by the control and released by the path core takes:
   * `seek()`, called synchronously for an in-buffer target, or
   * `holdThroughRelocation`, which carries the freeze to the swap.
   */
  holdPicture(): void {
    const video = this.video;
    if (!video || this.pictureHold || video.paused) return;
    this.pictureHold = { resumeWanted: this.wantsPlayback };
    this.wantsPlayback = false;
    // As in `pause()`: a picture frozen on purpose is not a stall. Core
    // re-arms on the first report after playback advances.
    this.stallWatchdog.suspend();
    video.pause();
    this.log.info('picture-held', { positionMs: this.lastPublishedEvent?.positionMs });
    this.publish(video);
  }

  /** Undo a hold that turned out not to be needed. */
  releasePicture(): void {
    const hold = this.pictureHold;
    if (!hold) return;
    this.pictureHold = undefined;
    this.wantsPlayback = hold.resumeWanted;
    const video = this.video;
    if (video && hold.resumeWanted) this.requestPlay(video, 'picture-hold-released');
  }

  localSeekCoverage(): readonly PlaybackTimeRange[] {
    const source = this.activeSource;
    if (!source) return [];
    if (source.mode === 'direct') return webLocalSeekCoverage(source, []);

    const video = this.video;
    if (!video) return [];
    // Refreshes the snapshot the UI sees, so local-seek admission and the
    // buffer indicator share one authority.
    this.publish(video);
    return this.lastPublishedEvent?.bufferedRangesMs ?? [];
  }

  seek(positionMs: number): void {
    const video = this.video;
    if (!video) {
      this.log.warn('local-seek-without-media', { positionMs });
      return;
    }
    // The target is in the buffer, so the control's hold is not needed.
    // Released before the seek so the element is running when it lands.
    this.releasePicture();

    this.publish(video);
    const targetMediaMs = this.mediaTimeline?.toMediaTime(positionMs);
    if (targetMediaMs === undefined) {
      this.log.warn('local-seek-before-timeline-origin', { positionMs, state: videoState(video) });
      return;
    }
    const bufferedHit = this.activeSource?.mode === 'direct'
      || (this.lastPublishedEvent?.bufferedRangesMs ?? []).some((range) => range.startMs <= positionMs && range.endMs >= positionMs);
    this.log.info('local-seek-request', {
      positionMs,
      targetMediaMs,
      mediaOriginMs: this.mediaTimeline?.mediaOriginMs,
      bufferedHit,
      state: videoState(video),
    });
    setDirectPlayReadAheadMode(this.directReadAheadSourceUrl, 'seeking');
    video.currentTime = targetMediaMs / 1000;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
    if (this.video) {
      this.video.volume = this.volume;
      if (this.options.legacyMediaElement && this.volume > 0) {
        this.video.muted = false;
        this.video.defaultMuted = false;
        this.video.removeAttribute('muted');
      }
    }
  }

  stop(): void {
    this.playRequestGeneration += 1;
    this.sourceGeneration += 1;
    this.failedSourceGeneration = undefined;
    this.degradedSourceGeneration = undefined;
    this.notFoundSourceGeneration = undefined;
    this.goneReportedGeneration = undefined;
    this.hlsLoadParkedWhilePaused = false;
    this.wantsPlayback = false;
    this.activeSource = undefined;
    this.mediaTimeline = undefined;
    this.keyframeIndex = undefined;
    this.lastPublishedEvent = undefined;
    this.log.debug('stop', this.video ? videoState(this.video) : undefined);
    if (this.video) this.finishStartRecorder(this.video, 'abandoned');
    this.startWatchdog.stop();
    this.stallWatchdog.stop();
    this.hls?.destroy();
    this.hls = undefined;
    this.hlsMediaRecovery = undefined;
    this.destroyRetiredHls();
    this.initialSeekCleanup?.();
    this.initialSeekCleanup = undefined;
    this.unsubscribeDirectDegradation?.();
    this.unsubscribeDirectDegradation = undefined;
    releaseDirectPlayReadAhead(this.directReadAheadSourceUrl);
    this.directReadAheadSourceUrl = undefined;
    const video = this.video;
    if (!video) return;
    this.clearSubtitleTracks(video);
    this.subtitleTextTrack = undefined;
    video.pause();
    this.attachedSourceGeneration = undefined;
    video.removeAttribute('src');
    video.load();
    video.parentNode?.removeChild(video);
    this.video = undefined;
  }

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeFailure(listener: PlaybackFailureListener): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  subscribeDegradation(listener: PlaybackDegradationListener): () => void {
    this.degradationListeners.add(listener);
    return () => this.degradationListeners.delete(listener);
  }

  /**
   * Records what an element does between being given a source and showing a
   * frame, and logs one line if that was slow or never happened. Armed before
   * `src` is set, since a start stuck at `readyState` 0 raises nothing. Covers
   * managed HLS and the hidden standby elements, which the start watchdog
   * does not. Observes only: the watchdogs own failure and retry.
   */
  private armStartRecorder(video: HTMLVideoElement, url: string, role: StartRole): void {
    this.finishStartRecorder(video, 'abandoned');
    const recorder = new StartRecorder(role, url, () => performance.now());
    const armedAt = performance.now();
    const sample = (): StartSample => ({
      readyState: video.readyState,
      networkState: video.networkState,
      bufferedEndS: video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : undefined,
      hidden: typeof document !== 'undefined' && document.hidden,
    });
    const names = [
      'loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'waiting', 'stalled',
      'suspend', 'emptied', 'abort', 'error', 'seeking', 'seeked',
    ] as const;
    const handlers = names.map((name) => [name, () => {
      recorder.event(name, sample());
      // HAVE_CURRENT_DATA is the first frame: something is paintable.
      if (video.readyState >= 2 && (name === 'loadeddata' || name === 'canplay' || name === 'playing')) {
        this.finishStartRecorder(video, 'first-frame');
      }
    }] as const);
    for (const [name, handler] of handlers) video.addEventListener(name, handler);
    const timer = setInterval(() => {
      recorder.sample(sample());
      if (performance.now() - armedAt >= START_RECORD_LIMIT_MS) this.finishStartRecorder(video, 'no-first-frame');
    }, 1_000);
    // An observer rather than `getEntriesByType`: the Resource Timing buffer
    // holds 250 entries and then records nothing new. Without an observer the
    // record says unknown.
    const requests: PerformanceResourceTiming[] = [];
    let observer: PerformanceObserver | undefined;
    try {
      observer = new PerformanceObserver((list) => {
        requests.push(...list.getEntries() as PerformanceResourceTiming[]);
      });
      observer.observe({ type: 'resource' });
    } catch {
      observer = undefined;
    }
    this.startRecorders.set(video, {
      recorder,
      requests: () => {
        if (!observer) return undefined;
        requests.push(...observer.takeRecords() as PerformanceResourceTiming[]);
        return requests;
      },
      cleanup: () => {
        for (const [name, handler] of handlers) video.removeEventListener(name, handler);
        clearInterval(timer);
        observer?.disconnect();
      },
    });
  }

  private finishStartRecorder(video: HTMLVideoElement, outcome: StartOutcome): void {
    const armed = this.startRecorders.get(video);
    if (!armed) return;
    this.startRecorders.delete(video);
    const entries = armed.requests();
    armed.cleanup();
    const record = armed.recorder.finish(outcome, entries);
    // Warn level, so the Samsung build keeps it: that target cannot be watched
    // any other way.
    if (record && shouldReportStart(record)) this.log.warn('source-start-record', record);
  }

  /**
   * Bounds a source the element accepted and never got a byte from. Fails as
   * `'stream'` so the coordinator fails over; a degradation would not help,
   * since only a fresh `play()` re-runs the media load algorithm.
   */
  private watchForStarvedStart(video: HTMLVideoElement, source: PlaybackSource, sourceGeneration: number): void {
    this.startWatchdog.start((visibleMs) => {
      if (sourceGeneration !== this.sourceGeneration || video !== this.video) return;
      const readAhead = directPlayReadAheadMetrics(this.directReadAheadSourceUrl);
      // The read-ahead worker sees every request the renderer dispatched, which
      // separates "the browser never asked" from "the node never answered".
      const dispatch = readAhead === undefined
        ? 'unknown-no-read-ahead-worker'
        : readAhead.demandFetches === 0
          ? 'renderer-never-dispatched'
          : readAhead.fetchedBytes === 0
            ? 'dispatched-node-sent-nothing'
            : 'bytes-reached-worker-not-element';
      const detail = {
        ...videoState(video),
        visibleMs,
        dispatch,
        visibilityState: typeof document === 'undefined' ? 'unknown' : document.visibilityState,
        mode: source.mode,
        url: source.url,
        readAhead,
      };
      this.log.error('source-start-starved', detail);
      this.failSourceGeneration(
        sourceGeneration,
        new PlaybackSourceError(
          `The stream delivered no data in ${Math.round(visibleMs / 1000)}s.`,
          'stream',
        ),
        detail,
      );
    });
  }

  /**
   * Bounds a generation whose picture has frozen with nothing arriving. Fails
   * as `'stream'` so the coordinator fails over. A native HLS player that
   * swallows the failure without raising `MediaError`, as Samsung's can, is
   * caught only here.
   */
  private watchForStall(video: HTMLVideoElement, source: PlaybackSource, sourceGeneration: number): void {
    // The stall budget belongs to the node serving this source, and every
    // attach path passes through here. A node with a longer hold than the
    // default would otherwise be called dead at its own frontier.
    this.stallWatchdog.useSourceBudgets(source);
    this.stallWatchdog.watch(({ visibleMs, positionMs, bufferedEndMs }) => {
      if (sourceGeneration !== this.sourceGeneration || video !== this.video) return;
      const detail = {
        ...videoState(video),
        visibleMs,
        stalledAtMs: Math.round(positionMs),
        // Absent stays absent: a player that cannot measure buffering is not
        // one whose buffer is at zero.
        bufferedEndMs: bufferedEndMs === undefined ? undefined : Math.round(bufferedEndMs),
        mode: source.mode,
        url: source.url,
      };
      // A generation already known to be gone explains its own stall: `stream`
      // would charge a node that is answering correctly. See `reportSourceGone`.
      if (this.notFoundSourceGeneration === sourceGeneration || this.goneReportedGeneration === sourceGeneration) {
        this.log.warn('source-stalled-after-gone', detail);
        this.reportSourceGone(
          sourceGeneration,
          new PlaybackSourceError('The node no longer has this source, and the buffer has run out.', 'not-found'),
          detail,
        );
        return;
      }
      this.log.error('source-stalled', detail);
      this.failSourceGeneration(
        sourceGeneration,
        new PlaybackSourceError(
          `Playback stopped and nothing arrived for ${Math.round(visibleMs / 1000)}s.`,
          'stream',
        ),
        detail,
      );
    });
  }

  private degradeSourceGeneration(sourceGeneration: number, error: Error, detail?: unknown): void {
    if (sourceGeneration !== this.sourceGeneration || this.degradedSourceGeneration === sourceGeneration) return;
    this.degradedSourceGeneration = sourceGeneration;
    this.log.warn('source-degraded', { error, detail });
    for (const listener of this.degradationListeners) listener(error);
  }

  /**
   * A source the node has no record of, reported once per generation on its
   * own latch: the shared degradation latch would swallow a 404 that follows
   * a transient network error.
   */
  private degradeSourceNotFound(sourceGeneration: number, error: Error, detail?: unknown): void {
    if (sourceGeneration !== this.sourceGeneration || this.notFoundSourceGeneration === sourceGeneration) return;
    this.notFoundSourceGeneration = sourceGeneration;
    this.log.warn('source-not-found', { error, detail });
    for (const listener of this.degradationListeners) listener(error);
  }

  /**
   * Reports that the node no longer has this source, and tears nothing down:
   * the buffered media keeps playing and is the runway the coordinator
   * recovers inside. Core stops the player if there is no replacement.
   *
   * Latched apart from `failedSourceGeneration`, so a later terminal failure
   * on the same generation is still raised.
   */
  private reportSourceGone(sourceGeneration: number, error: Error, detail?: unknown): void {
    if (sourceGeneration !== this.sourceGeneration || this.goneReportedGeneration === sourceGeneration) return;
    this.goneReportedGeneration = sourceGeneration;
    this.log.error('source-gone', { error, detail });
    for (const listener of this.failureListeners) listener(error);
  }

  private failSourceGeneration(sourceGeneration: number, error: Error, detail?: unknown): void {
    if (sourceGeneration !== this.sourceGeneration || this.failedSourceGeneration === sourceGeneration) return;
    this.failedSourceGeneration = sourceGeneration;
    this.playRequestGeneration += 1;
    this.wantsPlayback = false;
    this.log.error('source-terminal-failure', { error, detail });
    if (this.video) this.finishStartRecorder(this.video, 'failed');
    const hls = this.hls;
    this.hls = undefined;
    this.hlsMediaRecovery = undefined;
    // Stopped, not destroyed: it fetches nothing more from the failed node but
    // keeps the last frame up until the element is taken.
    this.retireHls(hls);
    this.video?.pause();
    for (const listener of this.failureListeners) listener(error);
  }

  /** Stop a failed generation fetching, and hold it for destruction at the cut. */
  private retireHls(hls: Hls | undefined): void {
    this.destroyRetiredHls();
    if (!hls) return;
    try {
      hls.stopLoad();
      this.retiredHls = hls;
    } catch (error) {
      // Nothing is worth a second failure here: destroy it and take the blank.
      this.log.warn('retired-hls-stop-failed', { error: error instanceof Error ? error.message : String(error) });
      try { hls.destroy(); } catch { /* already gone */ }
    }
  }

  /** Release a retired generation. Called only where the element is being taken. */
  private destroyRetiredHls(): void {
    const retired = this.retiredHls;
    this.retiredHls = undefined;
    if (!retired) return;
    try { retired.destroy(); } catch { /* the element is going anyway */ }
  }

  /**
   * @param install Whether this instance becomes the active one immediately.
   *   False for a replacement on its own element: the handlers guard on
   *   `this.hls !== hls`, so it loads and buffers but judges nothing until
   *   promoted.
   */
  private attachHls(
    Hls: typeof import('hls.js').default,
    video: HTMLVideoElement,
    url: string,
    sourceGeneration: number,
    install = true,
    startPositionMs?: number,
  ): { hls: InstanceType<typeof import('hls.js').default>; recovery: ManagedHlsMediaRecoveryBudget } {
    // hls.js's startPosition is raw source-local seconds and ignores
    // mediaOriginMs, so the initial-seek listener alone owns the resume seek.
    // A handover is the exception: nothing else seeks the hidden replacement,
    // and starting the loader at the join skips every fragment before it.
    const hls = new Hls(startPositionMs === undefined
      ? webHlsBufferConfig()
      : { ...webHlsBufferConfig(), startPosition: startPositionMs / 1000 });
    const mediaRecovery = new ManagedHlsMediaRecoveryBudget();
    if (install) {
      this.hls = hls;
      this.hlsMediaRecovery = mediaRecovery;
    }
    const attachedAt = performance.now();

    this.trackBuffers.delete(video);
    // Only ever this instance's own entry: a retired hls.js detaches after
    // its replacement has already created buffers on the same element.
    let createdBuffers: Partial<Record<string, SourceBuffer>> | undefined;
    hls.on(Hls.Events.BUFFER_CREATED, (_event, data) => {
      createdBuffers = {};
      for (const [name, track] of Object.entries(data.tracks)) if (track) createdBuffers[name] = track.buffer;
      this.trackBuffers.set(video, createdBuffers);
    });
    hls.on(Hls.Events.MEDIA_DETACHED, () => {
      if (createdBuffers && this.trackBuffers.get(video) === createdBuffers) this.trackBuffers.delete(video);
    });
    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      this.log.debug('hls-media-attached');
      this.requestPlay(video, 'hls-media-attached');
    });
    hls.on(Hls.Events.MANIFEST_LOADING, (_event, data) => this.log.debug('hls-manifest-loading', hlsEventSummary(data)));
    hls.on(Hls.Events.MANIFEST_LOADED, (_event, data) => this.log.debug('hls-manifest-loaded', hlsEventSummary(data)));
    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      this.log.info('hls-manifest-parsed', {
        elapsedMs: Math.round((performance.now() - attachedAt) * 10) / 10,
        data: hlsEventSummary(data),
      });
      this.requestPlay(video, 'hls-manifest-parsed');
    });
    hls.on(Hls.Events.LEVEL_SWITCHING, (_event, data) => this.log.debug('hls-level-switching', hlsEventSummary(data)));
    hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => this.log.debug('hls-level-switched', hlsEventSummary(data)));
    hls.on(Hls.Events.FRAG_LOADING, (_event, data) => {
      this.startRecorders.get(video)?.recorder.fragment('asked', data.frag?.sn);
      this.log.debug('hls-fragment-loading', hlsEventSummary(data));
    });
    hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
      this.startRecorders.get(video)?.recorder.fragment('got', data.frag?.sn);
      const stats = data.frag?.stats;
      if (stats && data.frag?.url) reportFragmentTransfer(data.frag.url, stats.loaded, stats.loading.first, stats.loading.end);
      if (data.frag?.sn !== 'initSegment') {
        const costMs = nodeStartCosts.firstFragment(url);
        if (costMs !== undefined) this.log.info('node-start-cost-measured', { url, costMs });
      }
      this.log.debug('hls-fragment-loaded', hlsEventSummary(data));
    });
    hls.on(Hls.Events.FRAG_BUFFERED, (_event, data) => {
      this.log.debug('hls-fragment-buffered', { data: hlsEventSummary(data), state: videoState(video) });
      mediaRecovery.observeBufferedContent();
      this.publish(video);
    });
    hls.on(Hls.Events.BUFFER_FLUSHED, () => this.publish(video));
    hls.on(Hls.Events.ERROR, (_event, data) => {
      // Before the guard: a standby's hls is not `this.hls` yet, and its
      // errors belong on the start record.
      this.startRecorders.get(video)?.recorder.hlsError(data as Parameters<StartRecorder['hlsError']>[0]);
      if (sourceGeneration !== this.sourceGeneration || this.hls !== hls) return;
      const payload = { data: hlsEventSummary(data), state: videoState(video) };
      // hls.js sets `response.code` on nonfatal fragment errors, so a gone
      // source is known while the buffer still has runway; the degradation
      // channel lets the coordinator regenerate on this node inside it.
      if (isHlsSourceNotFound(data)) {
        this.degradeSourceNotFound(
          sourceGeneration,
          new PlaybackSourceError(`Web HLS source not found (${data.details}).`, 'not-found', data),
          payload,
        );
      } else if (isHlsNetworkDegradation(data)) {
        this.degradeSourceGeneration(
          sourceGeneration,
          new PlaybackSourceError(`Web HLS network degradation (${data.details}).`, 'stream', data),
          payload,
        );
      }
      // Sample the generation-local clock before the recovery policy reads it.
      if (data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR) this.publish(video);
      const action = managedHlsErrorAction(
        data,
        mediaRecovery,
        this.lastPublishedEvent?.positionMs ?? 0,
        video.buffered.length > 0,
        // Viewer intent, not `video.paused`, which stays true between a play
        // request and the element running, when a refusing node must be judged.
        this.wantsPlayback,
      );
      if (action.action === 'nonfatal') {
        this.log.warn('hls-error-nonfatal', payload);
        return;
      }
      if (action.action === 'fail-unbuffered') {
        this.failSourceGeneration(
          sourceGeneration,
          new PlaybackSourceError(
            `Web HLS playback failed: this browser could not decode any of the stream it was sent (${action.details}).`,
            'media',
          ),
          { ...payload, occurrences: action.occurrences },
        );
        return;
      }
      this.log.error('hls-error-fatal', payload);
      if (action.action === 'park-paused') {
        // Kept out of the failure channel: nothing is torn down and no budget
        // is spent. `resume()` restarts the load and the error is judged then.
        this.log.warn('hls-load-parked-while-paused', { ...payload, details: action.details });
        this.hlsLoadParkedWhilePaused = true;
        hls.stopLoad();
        return;
      }
      if (action.action === 'fail-not-found') {
        // `not-found`, so the coordinator regenerates on this node rather than
        // condemning it. Nothing is torn down; the element plays what it has.
        this.reportSourceGone(
          sourceGeneration,
          new PlaybackSourceError(
            `Web HLS playback failed: the node no longer has this source (${action.details}).`,
            'not-found',
          ),
          payload,
        );
        return;
      }
      if (action.action === 'restart-network') {
        this.log.warn('hls-recovery-network-start-load', { ...payload, attempt: action.attempt });
        hls.startLoad(video.currentTime);
        return;
      }
      if (action.action === 'fail-network') {
        // A generation that only ever answered "not produced yet" is not
        // evidence against the node. `not-ready` makes core neither prepare a
        // standby nor fail over, since a replacement node would start from
        // nothing; the viewer still gets a stated failure.
        const held = isHlsSegmentHold(data);
        this.failSourceGeneration(
          sourceGeneration,
          new PlaybackSourceError(
            held
              ? `Web HLS playback failed: this node is still producing the stream (${action.details}).`
              : `Web HLS playback failed after bounded network recovery (${action.details}).`,
            held ? 'not-ready' : 'stream',
          ),
          { ...payload, attempts: action.attempts },
        );
        return;
      }
      if (action.action === 'recover-media') {
        this.log.warn('hls-recovery-media', { ...payload, recovery: action.recovery });
        hls.recoverMediaError();
        return;
      }
      if (action.action === 'fail-media') {
        this.failSourceGeneration(
          sourceGeneration,
          new PlaybackSourceError(
            `Web HLS playback failed: the browser media pipeline repeatedly rejected the stream (${action.details}).`,
            'media',
          ),
          { ...payload, recovery: action.recovery },
        );
        return;
      }
      this.failSourceGeneration(
        sourceGeneration,
        new PlaybackSourceError(
          `Web HLS playback failed with an unrecoverable player error (${action.details}).`,
          'unknown',
        ),
        payload,
      );
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    return { hls, recovery: mediaRecovery };
  }

  /**
   * Requests the file's byte index and republishes when it arrives. Off the
   * start path: until then, and for a file the node cannot index, Chrome's
   * own buffered figures stand.
   */
  private loadKeyframeIndex(video: HTMLVideoElement, source: PlaybackSource, sourceGeneration: number): void {
    const load = keyframeSource;
    if (!load) return;
    void load(source.mediaId).then((index) => {
      if (sourceGeneration !== this.sourceGeneration || video !== this.video) return;
      if (!index || !index.streams.some((stream) => stream.entries.length >= 2)) {
        this.log.info('keyframe-index-absent', { mediaId: source.mediaId });
        return;
      }
      this.keyframeIndex = index;
      this.log.info('keyframe-index-loaded', {
        mediaId: source.mediaId,
        container: index.container,
        offsets: index.offsets,
        streams: index.streams.map((stream) => `${stream.type}:${stream.entries.length}`),
      });
      this.publish(video);
    }).catch((error: unknown) => {
      this.log.warn('keyframe-index-failed', { mediaId: source.mediaId, error: error instanceof Error ? error.message : String(error) });
    });
  }

  private publish(video: HTMLVideoElement): void {
    const timeline = this.mediaTimeline;
    if (!timeline || video !== this.video) return;

    const rawBufferedRangesMs = playbackTimeRanges(video.buffered);
    const normalized = timeline.sample({
      positionMs: video.currentTime * 1000,
      bufferedRangesMs: rawBufferedRangesMs,
      seekableRangesMs: playbackTimeRanges(video.seekable),
    });
    // A reused element can emit events before the new generation establishes
    // its timestamp origin; those samples are dropped.
    if (!normalized) return;
    const index = this.activeSource?.mode === 'direct' ? this.keyframeIndex : undefined;
    const bufferedRangesMs = (index && directPlayBufferedRanges(index, normalized.bufferedRangesMs, video.duration * 1000))
      ?? normalized.bufferedRangesMs;

    // The watchdog needs both position and buffered end: a node producing
    // below realtime freezes the picture while the buffer fills, and that is
    // slow rather than dead.
    if (!video.paused) {
      const bufferedEndMs = bufferedRangesMs.reduce((end, range) => Math.max(end, range.endMs), 0);
      this.stallWatchdog.note(normalized.positionMs, bufferedEndMs);
    }

    const duration = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
    const currentMs = normalized.positionMs;
    const forwardBufferMs = forwardBufferMsAt(currentMs, bufferedRangesMs);
    this.hlsMediaRecovery?.observePlaybackPosition(
      currentMs,
      !video.paused && !video.ended && !video.seeking,
    );
    // Undefined for a transformed source or where the worker never registered.
    const readAheadMetrics = directPlayReadAheadMetrics(this.directReadAheadSourceUrl);
    const event: PlaybackEvent = {
      // Whole milliseconds: this goes back to the node as `seekMs`, and the
      // seek contract is integer milliseconds. A fractional position can make
      // a frame-accurate node answer with a generation starting just after it,
      // which core refuses to activate and re-requests for ever.
      positionMs: Math.round(currentMs),
      // Floored: this is the scrubber's `max`, which a drag to the far right
      // commits as a seek, so it must never claim media the element lacks.
      durationMs: Math.floor(duration),
      paused: video.paused,
      ended: video.ended,
      seeking: video.seeking,
      buffering: !video.paused
        && !video.ended
        && (video.seeking || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA),
      bufferedRangesMs: wholeMillisecondRanges(bufferedRangesMs),
      forwardBufferMs: Math.round(forwardBufferMs),
      streamOrigin: readAheadMetrics?.sourceOrigin || undefined,
      // The worker's cache beyond what the element has taken, which
      // `forwardBufferMs` (`video.buffered` only) cannot see. The key is absent
      // without a read-ahead: core reads absent as "no such cache" and zero as
      // "it holds nothing".
      ...(readAheadMetrics ? { readAheadBytes: readAheadMetrics.aheadBytes } : {}),
    };
    if (webPlaybackEventsEqual(this.lastPublishedEvent, event)) return;
    this.lastPublishedEvent = event;
    this.listeners.forEach((listener) => listener(event));
  }
}

export function webPlaybackEventsEqual(previous: PlaybackEvent | undefined, next: PlaybackEvent): boolean {
  if (!previous
    || previous.positionMs !== next.positionMs
    || previous.durationMs !== next.durationMs
    || previous.paused !== next.paused
    || previous.ended !== next.ended
    || previous.seeking !== next.seeking
    || previous.buffering !== next.buffering
    || previous.forwardBufferMs !== next.forwardBufferMs) return false;
  if (previous.streamOrigin !== next.streamOrigin) return false;
  // `readAheadBytes` is not compared: it changes on every prefetch response
  // and would defeat the dedupe. It rides along on events published for
  // another reason.

  const previousRanges = previous.bufferedRangesMs ?? [];
  const nextRanges = next.bufferedRangesMs ?? [];
  if (previousRanges.length !== nextRanges.length) return false;
  for (let index = 0; index < previousRanges.length; index += 1) {
    if (previousRanges[index].startMs !== nextRanges[index].startMs
      || previousRanges[index].endMs !== nextRanges[index].endMs) return false;
  }
  return true;
}

function supportedMime(media: HTMLMediaElement, mime: string): boolean {
  if (media.canPlayType(mime) !== '') return true;
  return typeof MediaSource !== 'undefined'
    && typeof MediaSource.isTypeSupported === 'function'
    && MediaSource.isTypeSupported(mime);
}

export class WebPlatform implements Platform {
  readonly name = 'web' as const;
  private readonly log = createClientLogger('playback.capabilities');
  private activePlayer?: WebPlayer;

  constructor(private readonly playerOptions: WebPlayerOptions = {}) {}

  /**
   * The screen automatic play is capped to. TV shells do not delegate here: a
   * browser screen there is the UI surface, not the panel.
   */
  displayResolution(): DisplayResolution | undefined {
    return browserDisplayResolution();
  }

  async capabilities(): Promise<PlaybackCapabilities> {
    const video = document.createElement('video');
    const probe = (mime: string) => supportedMime(video, mime);
    const mediaFeature = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? (query: string) => window.matchMedia(query).matches
      : undefined;
    // Ask the decoder that will be handed the stream: MediaSource for hls.js,
    // the engine's playlist support for native. The element's progressive-file
    // answer can differ.
    const managed = !this.playerOptions.forceNativeHls && managedHlsSupported();
    const mseProbe = managed && typeof window !== 'undefined' && window.MediaSource?.isTypeSupported
      ? (mime: string) => { try { return window.MediaSource.isTypeSupported(mime); } catch { return false; } }
      : undefined;
    const deliveryProbe = hlsDeliveryProbe(probe, mseProbe);
    const { videoCodecs, hlsVideoCodecs, audioCodecs, hlsAudioCodecs, containers, videoBitDepth, hdrTransfers, dolbyVision } =
      detectWebMediaCodecCapabilities(probe, mediaFeature, deliveryProbe);

    const capabilities: PlaybackCapabilities = {
      platform: 'web',
      videoCodecs,
      audioCodecs,
      containers,
      hlsFmp4: nativeHlsSupported(video) || managedHlsSupported(),
      // Probed separately: a set can play MPEG-TS segments and black-screen on fMP4.
      hlsTs: detectHlsTsSupport(probe) || managedHlsSupported(),
      dash: false,
      // Both gate what the server hands over. Over-claiming gives a black
      // screen; under-claiming only a needless transcode.
      hdr: hdrTransfers,
      videoBitDepth,
      // What the delivery decoder accepts, sent only when it differs from the
      // element's list, which the chooser falls back to.
      ...(hlsVideoCodecs.length !== videoCodecs.length ? { hlsVideoCodecs } : {}),
      ...(hlsAudioCodecs.length !== audioCodecs.length ? { hlsAudioCodecs } : {}),
      // Omitted when empty: absent and empty mean the same.
      ...(dolbyVision.length > 0 ? { dolbyVision } : {}),
    };
    // Only where hls.js drives playback: builds that force the native player
    // never fetch it.
    if (managed) warmHls();
    this.log.info('detected', {
      platform: capabilities.platform,
      containers: capabilities.containers.join(', '),
      videoCodecs: capabilities.videoCodecs.join(', '),
      audioCodecs: capabilities.audioCodecs.join(', '),
      hlsFmp4: capabilities.hlsFmp4,
      decoderResolutionLimit: 'none',
      videoBitDepth,
      dolbyVision: dolbyVision.length > 0 ? dolbyVision.join(', ') : 'not-advertised',
      hdr: capabilities.hdr.length > 0 ? capabilities.hdr.join(', ') : 'not-advertised',
    });
    return capabilities;
  }

  createPlayer(): Player {
    this.activePlayer = new WebPlayer(this.playerOptions);
    return this.activePlayer;
  }

  /**
   * Freezes the picture for a seek that may need a new generation. Called by
   * the control, because the coordinator tells a player nothing until the
   * replacement exists, and the runtime keeps its player private.
   */
  holdPicture(): void {
    this.activePlayer?.holdPicture();
  }

  /** Undo a hold whose seek turned out to be servable from the buffer. */
  releasePicture(): void {
    this.activePlayer?.releasePicture();
  }
}
