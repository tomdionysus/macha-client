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
import type { MediaTechnicalProfile, PlaybackCapabilities, PlaybackEvent, PlaybackSource, PlaybackTimeRange, PlaybackTransition } from '@machafoundation/core';
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
  subscribeDirectPlayReadAheadFailure,
} from '../playback/directPlayReadAhead';
import { hlsEventSummary, videoState, WebMediaDiagnostics } from './WebMediaDiagnostics';
import { nodeStartCosts } from '../playback/nodeStartCosts';
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

/**
 * How long a start is recorded before it is reported as never having shown a
 * frame: a node reclaims a session that was never streamed at 120 s, so past
 * this the question is no longer the start but the reclaim.
 */
const START_RECORD_LIMIT_MS = 120_000;

function clearTextTrackCues(track: TextTrack): void {
  // TextTrack.cues may be null while disabled. Hidden keeps the track
  // non-rendering while making its cue list available for deterministic reset.
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
  // Chromium 47 (Tizen 3) has `fetch` but not response streams, so `body` is
  // undefined there. Reading that as "no bytes arrived" made every warm
  // standby the Samsung ever prepared fail its own validation and be thrown
  // away, leaving the set with only the slow path it is least able to take.
  // The buffered read costs the bytes the caller's Range header has already
  // bounded.
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
 * How long a preflight may wait before calling a node unable to serve a source.
 *
 * **Derived, not chosen, and that is the whole point.** This was 5,000 ms — a
 * number picked in isolation, against a server that gives itself 15,000 ms to
 * start a pipeline. A standby is a freshly created transcode generation and the
 * server's pipeline is lazy: nothing is produced until something asks, so the
 * preflight's own request is what starts production and then waits for it.
 * Measured against `es-1` on 2026-09-17 the first fragment of such a generation
 * took **9.0 s**. Every standby slower than five seconds was therefore recorded
 * as "that node cannot serve this" when it meant "that node had not finished
 * starting", and the rescue was discarded — silently, and worst on exactly the
 * cold, busy or distant nodes a standby exists for.
 *
 * So it clears what a healthy node is entitled to take: its full startup
 * budget, plus one segment hold for the request that lands past the production
 * frontier, plus room for two playlist round trips and the transfer itself.
 * Two independently chosen numbers that were never compared is the fault this
 * project keeps recording; this one is written as the sum it has to exceed.
 *
 * It bounds the whole walk — both playlists and both media ranges share it —
 * and it is a **gate**, so it must eventually give up. Warming a pipeline is a
 * different question that happens to make the same request, and must not
 * borrow this number: a warm-up has no verdict to reach and no reason to stop.
 */
export const HLS_PREFLIGHT_TIMEOUT_MS = SERVER_STARTUP_TIMEOUT_MS + SERVER_SEGMENT_HOLD_MS + 4_000;

/**
 * Validate a playlist and its initial fMP4 data without attaching a decoder.
 *
 * The deadline comes from the node serving this source when it stated one, and
 * falls back to the derived constant above when it did not. Absence means the
 * node could not say, never zero — and the fallback is the longer of the two,
 * which is the safe direction: a host must not shorten a budget on a missing
 * field, because the shorter of two deadlines silently wins and the other layer
 * then looks broken.
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


/**
 * Budgets for a seamless generation handover. All of them fail *towards* the
 * teardown path: a handover that cannot be set up in time is abandoned and the
 * viewer gets today's behaviour, which is worse but never worse than broken.
 */
const HANDOVER_READY_TIMEOUT_MS = 20_000;
/**
 * How long to wait for the replacement to buffer the join point.
 *
 * The join is `clockOffsetMs` into the replacement — however far the viewer
 * travelled while core negotiated — so it is not resident at `canplay` and has
 * to be fetched. Generous, because the cost of waiting is nothing (the viewer
 * is still watching the outgoing source) and the cost of giving up is the
 * teardown path.
 */
const HANDOVER_BUFFER_TIMEOUT_MS = 25_000;
/**
 * How long the replacement is watched before its progress towards the join is
 * treated as a measurement rather than as noise.
 *
 * A segment arrives whole, so a rate taken across less than one is measuring
 * quantisation rather than production. Six seconds covers a segment and the
 * hold a node may put on it. Deliberately **not** derived from
 * `budgets.segmentHoldMs`: that figure shapes retries and does not bound them,
 * and this is an observation window rather than a deadline.
 */
const HANDOVER_CONVERGENCE_WINDOW_MS = 6_000;
const HANDOVER_BUFFER_POLL_MS = 100;
const HANDOVER_SEEK_TIMEOUT_MS = 8_000;
const HANDOVER_JOIN_TIMEOUT_MS = 20_000;
const HANDOVER_JOIN_POLL_MS = 20;
/**
 * How long the outgoing position may stand still before the cut is forced.
 *
 * Its buffer running out is the normal end of a reaped generation, and once the
 * picture has stopped there is nothing left to protect — waiting for a position
 * it can never reach only lengthens the gap.
 */
const HANDOVER_OUTGOING_STALL_MS = 400;
/**
 * How far ahead of the live position the join is placed.
 *
 * Far enough that the outgoing element has not already passed it by the time
 * the seek completes, short enough that nobody waits for the cut. It is not a
 * safety margin — the loop below waits for the position to actually arrive.
 */
const HANDOVER_JOIN_LEAD_MS = 400;
/**
 * Below this much buffered media, preparing a second element is not worth it:
 * there is not enough runway to finish before the picture stops anyway, and the
 * teardown path reaches the same place sooner.
 */
const HANDOVER_MINIMUM_RUNWAY_MS = 3_000;

/**
 * How much playable media the replacement must hold *beyond* the join before it
 * is worth promoting.
 *
 * Resident-at-the-join is not enough on its own: cutting the instant the join
 * arrives promotes an element with nothing behind it, and it starves a couple of
 * seconds later. The viewer sees the picture return and then drop again, which
 * reads worse than the single gap it replaced. Waived when the outgoing element
 * has already stopped, because then the margin is a luxury being paid for out of
 * a frozen picture.
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
 * Whether the replacement has lost its race to the join, as opposed to merely
 * not having won it yet.
 *
 * **The join is not a fixed point.** It is recomputed from the live position
 * every turn, so it recedes at whatever rate the viewer is watching, while the
 * replacement fills at whatever rate its node produces. A node encodes a
 * generation sequentially from its own start, so the replacement can only ever
 * arrive if it produces faster than the viewer consumes. A stream copy does,
 * comfortably. A software transcode of a large source does not, and then the
 * distance never closes — measured live on 2026-09-20 at ~2 s buffered against
 * a join at 33.9 s, still diverging when the 25 s budget expired, after which
 * the fallback rewound the viewer 20 s. The handover had no way to arrive and
 * spent the whole budget finding that out.
 *
 * **Both rates are measured, never assumed.** Not `source.mode`, which says
 * what a node is doing and not how fast; not a constant for the viewer's rate,
 * which a trick-play speed would falsify. Only the distance and whether it is
 * closing, which is the quantity the answer actually depends on and is
 * observable from here.
 *
 * Answers `false` until a window has passed, because a segment arrives whole
 * and a rate read from inside one is quantisation rather than production —
 * giving up on that would abandon handovers that work today.
 */
export function handoverJoinLost(observation: HandoverJoinObservation): boolean {
  const {
    startDeficitMs, deficitMs, observedMs, remainingMs,
    windowMs = HANDOVER_CONVERGENCE_WINDOW_MS,
  } = observation;
  if (observedMs < windowMs) return false;
  const closedMs = startDeficitMs - deficitMs;
  // Holding station or losing ground: no budget is long enough for a distance
  // that is not shrinking.
  if (closedMs <= 0) return true;
  return deficitMs / (closedMs / observedMs) > remainingMs;
}

/**
 * Where the teardown path should attach after a handover was abandoned.
 *
 * Core computed its request before the attempt began; the viewer then watched
 * through however long the attempt took. `clockOffsetMs` is what maps one
 * generation's clock onto the other's — taken at the moment of the request,
 * when both denoted the same content — so the live position expressed in the
 * replacement's clock is where they have genuinely got to.
 *
 * **Only ever forward.** A position that has not moved leaves the request
 * exactly as core made it, because going backwards is the fault this exists to
 * fix rather than an outcome to allow: measured live 2026-09-20 at a 20 s
 * rewind after a 30 s wait.
 */
export function handoverFallbackPositionMs(
  requestedMs: number,
  clockOffsetMs: number,
  livePositionMs: number,
): number {
  // Never before the generation's start: after a lead move core's request is
  // negative, and the earliest place a replacement can attach is its first
  // frame.
  return Math.max(0, requestedMs, livePositionMs + clockOffsetMs);
}

/**
 * What the handover does with a join that may lie before the incoming
 * generation's start.
 *
 * After a lead move (core `d58375a`) the node produces from ahead of the
 * viewer, so the join is negative in the new clock until the viewer, still
 * watching the outgoing element, reaches the generation's start. That wait is
 * the lead working, and must not be run through the convergence race, which
 * would read a join behind the buffer as one receding faster than it fills. A
 * stopped outgoing picture ends the wait: the cut goes to the start, because
 * the position it was waiting for will never come.
 */
export function leadJoinStep(joinNewMs: number, outgoingStalled: boolean): 'wait' | 'join-at-start' | 'race' {
  if (joinNewMs >= 0) return 'race';
  return outgoingStalled ? 'join-at-start' : 'wait';
}

/** What the hold needs to know about the two sides of a relocation. */
export interface RelocationHoldSubject {
  /** The replacement, as the resolver declared it — never sniffed from a URL. */
  incomingIsManifest: boolean;
  /** Whether hls.js drives the replacement, rather than the element itself. */
  managedHls: boolean;
  /** `readyState` of the element showing now, or `undefined` if there is none. */
  outgoingReadyState: number | undefined;
}

/** `HTMLMediaElement.HAVE_CURRENT_DATA`, named so the rule reads without a DOM. */
const HAVE_CURRENT_DATA = 2;

/**
 * Whether the picture can be held while the replacement is built beside it.
 *
 * **The question is about the replacement, not about what is on screen.** The
 * replacement has to be prepared on a second element, and only hls.js can be
 * pointed at one the viewer cannot see: a native HLS player and a plain URL are
 * both loaded by the element itself, which is the element showing the frame
 * this exists to keep.
 *
 * The outgoing side is never touched, only frozen, so what it happens to be
 * playing does not bear on it. Requiring a manifest there too cost a measured
 * **16.5 s of black screen** on 2026-09-20: selecting Transcode from Direct
 * Play mid-playback is a representation change, the outgoing element held a
 * Direct Play source, and the hold declined on that alone — the one transition
 * a viewer asks for by hand and watches for the whole of.
 */
export function canHoldThroughRelocation(subject: RelocationHoldSubject): boolean {
  if (!subject.incomingIsManifest || !subject.managedHls) return false;
  // Nothing to hold unless the outgoing element actually has a frame up. This
  // is also what declines the first generation of a session, where there is
  // nothing on screen and blanking costs the viewer nothing.
  return (subject.outgoingReadyState ?? 0) >= HAVE_CURRENT_DATA;
}

/**
 * What a handover attempt leaves behind for the path that follows it.
 *
 * `resumeAtMs` is where the viewer has actually reached, in the replacement
 * generation's clock, and is present only when the attempt took time the viewer
 * spent watching. Absent means the request core made still describes them.
 */
type HandoverOutcome = { handedOver: true } | { handedOver: false; resumeAtMs?: number };

/** Declined before a second element existed, so no time has passed and nothing has moved. */
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
 * How much playable media sits in front of a position, in the ranges given.
 *
 * Only a range that covers the position counts: media beyond a hole is not
 * runway, because the element stops at the hole. A range starting just ahead is
 * allowed the same 250 ms of slack the published figure has always used, since
 * the element and the ranges it reports do not agree to the millisecond.
 *
 * Position and ranges must share a clock; which clock does not matter, because
 * an origin common to both cancels in the subtraction. That is what lets the
 * same arithmetic serve the published event, which works in generation time,
 * and a direct reading of an element, which works in its own media time.
 */
/**
 * Ranges stated in whole milliseconds, widened rather than narrowed.
 *
 * These are what core admits a local seek against, and the target it checks is
 * a whole millisecond. A boundary 0.08 ms inside the request decides
 * differently from one that is not, so the edges have to be made whole — and
 * the direction is not arbitrary. Narrowing refuses a seek the element could
 * have served, and the viewer pays a whole generation negotiation for it.
 * Widening claims at most one millisecond it does not hold, which is a
 * fraction of one frame and lands the element inside media it has.
 */
export function wholeMillisecondRanges(ranges: PlaybackTimeRange[]): PlaybackTimeRange[] {
  return ranges.map((range) => ({
    startMs: Math.floor(range.startMs),
    endMs: Math.ceil(range.endMs),
  }));
}

export function forwardBufferMsAt(positionMs: number, ranges: PlaybackTimeRange[]): number {
  let forwardMs = 0;
  for (const range of ranges) {
    if (range.startMs <= positionMs + 250 && range.endMs >= positionMs) {
      forwardMs = Math.max(forwardMs, range.endMs - positionMs);
    }
  }
  return forwardMs;
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
   * Whether a lead move may hand this player a negative position.
   *
   * Only the managed-HLS handover can keep the outgoing picture playing while
   * the viewer travels to a generation that starts ahead of them. Native HLS,
   * which the Samsung build forces, declines the handover and would attach at
   * the generation's start, skipping the viewer forward by the whole lead.
   */
  get holdsThroughLead(): boolean {
    return shouldUseManagedHls(this.options.forceNativeHls, managedHlsSupported());
  }

  /**
   * Whether core must hold a source back until the node has produced media.
   *
   * The native-HLS path only, the complement of the path above: a native
   * player handed a playlist whose first fragment answers `500
   * segment_not_ready` reports a network failure immediately and permanently,
   * and has no retry policy this client can reach. hls.js retries holds itself.
   */
  get needsProducedSource(): boolean {
    return !shouldUseManagedHls(this.options.forceNativeHls, managedHlsSupported());
  }

  private host?: HTMLElement;
  private video?: HTMLVideoElement;
  private hls?: Hls;
  /**
   * A generation that has failed and been stopped, but not yet destroyed.
   *
   * `destroy()` detaches the MediaSource, and the element goes black the moment
   * it does. Doing that at the point of diagnosis puts the picture out seconds
   * before anything can replace it — measured 2026-09-21 on a killed node at
   * ~9 s of black, all of it after the failure was already known. So a failed
   * generation is stopped where it fails and destroyed where it is replaced,
   * which is the rule `promoteHandover` already states: release the outgoing
   * generation after the cut, never before it.
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
   * The generation whose source the element is actually holding, which is not
   * the current generation while one is being waited on.
   *
   * The element's own `error` event is the one failure channel that cannot
   * carry a generation: it is registered once, on the element, so it reports
   * whatever `sourceGeneration` happens to be when it fires. A native HLS
   * source is now waited on before it is attached, which opens a real window
   * where the element still holds the dying generation while the counter has
   * already moved — and an error arriving in that window would be charged to
   * a node that has not been given a URL yet.
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
   * A media element with every listener this player needs, owned by nobody yet.
   *
   * Split from `ensureMediaElement` so a replacement generation can be built and
   * buffered on its own element while the current one keeps playing. Every
   * listener below already guards on `video !== this.video`, so an element that
   * is not the active one is wired and inert — it publishes nothing, fails
   * nothing and resumes nothing until it is promoted. That property is what
   * makes the handover safe, and it was already true for other reasons.
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
      // Teardown deliberately clears activeSource before removing src; do not
      // turn those media-element events into a generation failure.
      if (!this.activeSource || video !== this.video) return;
      if (this.attachedSourceGeneration !== this.sourceGeneration) return;
      // Direct Play's version of the same judgement, and the only way to make
      // it. The read-ahead worker hands a 404 body to the element as though it
      // were media — deliberately, because not splicing an alternate over a 404
      // is older than any of this — so the element raises a generic decode or
      // unsupported error and the status is nowhere in it. What we do have is
      // that the worker already told us this source was gone, for this same
      // generation. Without that memory the reported title's own path, which is
      // Direct Play on Chrome, would still condemn a healthy node.
      if (this.notFoundSourceGeneration === this.sourceGeneration) {
        this.reportSourceGone(
          this.sourceGeneration,
          new PlaybackSourceError('The node no longer has this source.', 'not-found', video.error),
          videoState(video),
        );
        return;
      }
      const failure = webMediaElementFailure(video.error);
      this.failSourceGeneration(this.sourceGeneration, failure, videoState(video));
    });
    // Evidence that bytes actually reached the element, ending the start
    // watchdog. `progress` is the one that matters — it fires as media data
    // arrives, long before readyState leaves HAVE_NOTHING, which is what lets
    // the watchdog distinguish a slow source from a silent one. The rest are
    // belt and braces for an engine that reaches readiness without one, and
    // `error` hands the failure to the element's own channel instead.
    for (const name of ['progress', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'error'] as const) {
      video.addEventListener(name, () => this.startWatchdog.noteProgress());
    }
    const resumeWhenReady = () => {
      if (!this.wantsPlayback || !video.paused) return;
      this.requestPlay(video, 'media-ready');
    };
    // Source attachment and MSE setup are asynchronous. A play() request made
    // before the media element has a usable source may be rejected by Chromium;
    // readiness events retry the same viewer intent.
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
    // Before anything is torn down, ask whether this generation can be replaced
    // without the viewer seeing it — but only when the viewer did not ask to
    // move. Hiding a replacement they requested means holding them at the old
    // position while it prepares: measured at 14.5 s of the previous scene with
    // the clock already reading the destination, which is a worse lie than the
    // interruption it avoids. A relocation therefore falls through to the
    // teardown path, which attaches at the new position and lets them see it
    // happen — the behaviour every target had before handovers existed, and
    // the default here, so a coordinator too old to say stays correct.
    if (transition === 'continue') {
      const handover = await this.handOverToSource(source, positionMs, startPaused);
      if (handover.handedOver) return true;
      // The attempt is over and the viewer kept watching through it. Attach at
      // where they are now, not at the position core computed before it began,
      // or the fallback for a slow handover is a rewind of however long it took.
      positionMs = handover.resumeAtMs ?? positionMs;
    }
    // A lead move's position is negative until the viewer reaches the
    // generation. Every path below attaches, and nothing can attach before
    // the generation's first frame.
    positionMs = Math.max(0, positionMs);
    // The teardown path below blanks the element, because hls.js is handed a
    // MediaSource object URL and attaching a new one resets whatever was
    // showing. Hold the picture instead: pause where they were, build the
    // replacement beside it, and swap when it can present.
    //
    // **Asked for on both transitions, and for a reason measured on 2026-09-21.**
    // A mode switch arrives as `continue`, and with Direct Play outgoing the
    // handover above declines without preparing anything — so gating the hold
    // on `transition !== 'continue'` meant the one transition a viewer makes by
    // hand, and watches for the whole of, was the one that could not hold its
    // picture. Measured before this: `source-load-begin`, `media-element-reused`
    // and `readyState` 0 with no hold attempted at all.
    //
    // **An abandoned handover is not a reason to skip it, and watching one
    // proved that.** The gate here was `resumeAtMs !== undefined` — "the
    // handover spent time, so do not make the viewer wait twice" — and on
    // 2026-09-21 a handover abandoned at 6 s
    // (`join-receding-faster-than-it-fills`) left the outgoing generation with
    // about 10 s of runway still on the element and a picture the viewer was
    // still watching, and this threw it away. Time spent is not the question;
    // whether there is still a frame to keep is, and
    // `canHoldThroughRelocation()` asks exactly that.
    if (await this.holdThroughRelocation(source, positionMs, startPaused)) return true;
    const playRequestGeneration = ++this.playRequestGeneration;
    const sourceGeneration = ++this.sourceGeneration;
    this.failedSourceGeneration = undefined;
    this.degradedSourceGeneration = undefined;
    this.notFoundSourceGeneration = undefined;
    this.goneReportedGeneration = undefined;
    this.hlsLoadParkedWhilePaused = false;
    this.wantsPlayback = !startPaused;
    // Suppress media-element teardown events from the previous source. The new
    // generation timeline must not observe or learn an origin from old buffer
    // residency on the reused <video> element.
    this.activeSource = undefined;
    this.attachedSourceGeneration = undefined;
    this.mediaTimeline = undefined;
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
    // Whatever a failed generation was still holding on screen: this path is
    // about to blank the element anyway.
    this.destroyRetiredHls();
    this.startWatchdog.stop();
    this.stallWatchdog.stop();

    const existingVideo = this.video;
    const video = this.ensureMediaElement();
    if (existingVideo) {
      // Keep the media element itself across transformed seek generations.
      // Recreating it forces the browser to rebuild the entire playback DOM
      // and can also drop element-scoped state such as fullscreen/PiP.
      video.pause();
      this.log.debug('media-element-reused');
    }

    this.activeSource = source;
    // `generation-start`: the loader below is not given a start position, so it
    // fetches from the generation's own beginning and the initial-seek listener
    // samples at `currentTime` 0 before it seeks. `positionMs` here is the
    // server's `seek_offset_ms` into the generation — where to seek to, never
    // where the media clock begins.
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
        // publish() establishes the generation's browser-media timestamp origin
        // as soon as residency is observable. Never write a source-local time
        // directly into currentTime for transformed HLS: MSE may expose a
        // non-zero/absolute media clock for this generation.
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

    // Whether the media element itself performs the transfer. It does for a
    // plain URL, direct or native-HLS; it does not when hls.js drives, because
    // there the element is fed an already-open MediaSource and hls.js owns
    // both the fetching and its own (bounded) error channel. Only the former
    // can starve silently, so only the former is watched.
    let elementOwnsFetch = false;
    this.armStartRecorder(video, source.url, 'primary');

    // Declared by the resolver, never sniffed: a native player handed an
    // undeclared .m3u8 parses the playlist as media and reports a source error.
    if (source.isManifest) {
      if (shouldUseManagedHls(this.options.forceNativeHls, managedHlsSupported())) {
        this.log.info('hls-js-selected', { url: source.url });
        // Usually already resolved: the capability probe warms it while the
        // session is still being negotiated.
        const hlsModule = await loadHls();
        if (existingVideo) {
          // hls.js manages the media element's source itself (a MediaSource
          // object URL) rather than a plain URL we assign, so it needs an
          // explicit reset of whatever the previous generation left behind.
          video.removeAttribute('src');
          video.load();
        }
        this.attachHls(hlsModule, video, source.url, sourceGeneration);
        this.attachedSourceGeneration = sourceGeneration;
      } else if (this.options.forceNativeHls || nativeHlsSupported(video)) {
        this.log.info('hls-native-selected', { url: source.url });
        // No removeAttribute('src')/load() reset here, for the reason the
        // direct path below records: it was observed live to leave the element
        // at readyState 0 forever, no request issued and no error raised.
        //
        // No readiness wait here either. A native player cannot ride a
        // `500 segment_not_ready` hold, so it must not be handed a generation
        // that has produced nothing; core now holds the source back until the
        // session route reports media produced, because this player declares
        // `needsProducedSource`. The zero-byte fragment probe that did this
        // here is gone (Tom, 2026-09-23: a zero-byte check is a hack).
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
          // The Direct Play half of the same judgement the managed-HLS error
          // handler makes. A 404 means the node has no record of this source —
          // a reaped session, or a range past the end of what it covers — and a
          // 410 means the generation it belonged to has been superseded.
          // Neither is evidence against the node. Without this the worker's
          // failure arrives as `stream`, the node is condemned for answering
          // honestly, and a session that only needed re-creating takes the
          // viewer to a failure screen naming somewhere else entirely.
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
      // No manual removeAttribute('src')/load() reset before this: assigning a
      // new src already runs the media element load algorithm and supersedes
      // whatever the previous generation was doing. Doing both back-to-back in
      // the same tick was observed live to leave the element stuck at
      // readyState 0 forever (no request ever issued, no error) while the
      // read-ahead Service Worker was controlling the page — the redundant
      // reset raced the reassignment rather than the two ever combining safely.
      video.src = directUrl;
      this.attachedSourceGeneration = sourceGeneration;
      elementOwnsFetch = true;
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
   * Replace the playing generation with another one without interrupting the
   * picture, by preparing it on a second media element and promoting that
   * element once it is buffered and aligned.
   *
   * **Why a second element and not a second source.** hls.js cannot be handed a
   * new source in place: `loadSource()` on a live instance detaches the media,
   * resets the buffer and empties the element, measured — so it destroys the
   * runway exactly as a teardown does. Nor can two generations be appended to
   * one SourceBuffer, because each carries its own timeline origin, init segment
   * and fragment boundaries. The only way the viewer's media survives the swap
   * is for the replacement to be decoding somewhere else first.
   *
   * This is the transcode counterpart of what the Direct Play read-ahead worker
   * already does for a dying node. That works by holding several upstream URLs
   * behind one stable proxy URL, which is only possible because a byte range is
   * the same bytes from any node. A transcode generation is not interchangeable
   * with another node's, so the swap has to happen a layer up — at the element,
   * rather than at the URL.
   *
   * **Alignment is the part that must be exact.** The replacement is created for
   * the position the viewer had reached when core asked for it, and the viewer
   * keeps moving while it buffers. Promoting it at its own start therefore
   * replays the difference; at two seconds that is plainly audible. So the
   * offset between the two generations' clocks is taken at the moment of the
   * request, a join point is chosen slightly ahead of the live position, the
   * replacement is seeked there while still hidden, and the swap happens when
   * the outgoing element actually reaches it. Measured live at ~6 ms of content
   * error and a 0.6 ms handover, with sound, judged seamless by ear.
   *
   * Hidden means `display: none`, which is enough: an unrendered element still
   * buffers, and buffered faster than realtime in testing. Element visibility
   * does not gate MSE. **Tab** visibility gates everything — a backgrounded tab
   * stops decoding entirely — and that case is deliberately not handled here,
   * because a gap nobody is watching is not a gap worth paying for.
   */
  private async handOverToSource(
    source: PlaybackSource,
    positionMs: number,
    startPaused: boolean,
  ): Promise<HandoverOutcome> {
    const outgoing = this.video;
    const host = this.host;
    const outgoingEvent = this.lastPublishedEvent;
    // Declined before anything is prepared: no time has passed, so the position
    // core asked for is still the position the viewer is at.
    if (!host || !outgoing || !outgoingEvent || startPaused) return DECLINED_HANDOVER;
    // Only a generation that is actually playing has media to protect.
    if (outgoing.paused || !this.wantsPlayback || !this.activeSource) return DECLINED_HANDOVER;
    // Both sides must be managed HLS. The native path owns its own element
    // source, and Direct Play already fails over inside the worker.
    if (!source.isManifest || !this.activeSource.isManifest) return DECLINED_HANDOVER;
    if (!shouldUseManagedHls(this.options.forceNativeHls, managedHlsSupported())) return DECLINED_HANDOVER;
    // Nothing to hand over from if the outgoing generation never established a
    // clock, and nothing to hand over to if its buffer is already spent.
    //
    // **Read from the element, not from the event.** `outgoingEvent` is the
    // sample core replied to, and how old it is has no bound: `publish()`
    // reports while the element is playing, so an element that has stopped
    // emitting leaves a figure that can only overestimate the runway — and an
    // element that has stopped is exactly the one this gate must not be
    // generous about. The element itself answers for now. Raised by the
    // Android TV client on 2026-09-19, which hit the same shape harder because
    // it reads its runway for a failure decision.
    //
    // The clock offset below still comes from `outgoingEvent`, and must: core
    // computed its request from that sample, so those two positions denote the
    // same content by construction. A fresher position there would pair the
    // viewer's place with a request that was never about it.
    const runwayMs = forwardBufferMsAt(outgoing.currentTime * 1000, playbackTimeRanges(outgoing.buffered));
    if (runwayMs < HANDOVER_MINIMUM_RUNWAY_MS) return DECLINED_HANDOVER;

    const sourceGeneration = this.sourceGeneration + 1;
    const startedAt = performance.now();
    // The two generations' clocks differ by a fixed amount: at this instant the
    // viewer is at `outgoingEvent.positionMs` on the old one and core is asking
    // for `positionMs` on the new one, so those denote the same content.
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
      // Where the viewer has actually reached, stated in the replacement's
      // clock, so the teardown path attaches at the position they are at rather
      // than the one core computed before the attempt.
      //
      // Measured live 2026-09-20: 30 s spent on a handover that could not
      // arrive, and then the fallback put the viewer back 20 s, because
      // `positionMs` is where they were when core asked. Every abandonment has
      // spent some time, and all of it is content the viewer has now watched.
      //
      // Only ever forward. `Math.max` because a position that has not moved —
      // an outgoing element that stopped, or a decline taken immediately — must
      // leave the request exactly as core made it, and because going backwards
      // is the fault being fixed rather than a place to land.
      //
      // Withheld once the element is no longer ours: a superseded handover's
      // live position belongs to whatever replaced it, and the clock offset
      // taken at the start does not describe it.
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
      // Where the cut will land, near enough: the viewer is at `positionMs` on
      // the replacement's clock the moment core asks, and will have moved a
      // little further by the time this is ready. Only a starting hint — the
      // buffered-join loop below still decides the exact point.
      const expectedJoinMs = Math.max(0, positionMs + HANDOVER_JOIN_LEAD_MS);
      built = this.attachHls(hlsModule, incoming, source.url, sourceGeneration, false, expectedJoinMs);

      // A led generation may take as long as its lead to become ready: the
      // viewer is still watching the outgoing picture for all of it. Measured
      // 2026-09-23: gbni-1 took 20.3 s to a first fragment, past the 20 s
      // this used to allow everything.
      const ready = await waitForMediaEvent(incoming, 'canplay', Math.max(HANDOVER_READY_TIMEOUT_MS, leadMs));
      if (!ready) return abandon('not-ready-in-time');
      if (this.video !== outgoing) return abandon('superseded-while-preparing');

      // The replacement's own clock, established from what it has buffered.
      //
      // Told the position it was started at, not zero. Now that the loader
      // begins at the join, the first resident fragment is *not* the generation
      // origin, and a timeline that assumed it was would place every later
      // mapping a join's width out. hls.js puts `currentTime` at its
      // `startPosition` once metadata lands, which is inside residency, so the
      // origin resolves from the position rather than from the buffer's edge.
      const timeline = new WebMediaTimeline(source.mode, expectedJoinMs, 'requested-position');
      const sampled = timeline.sample({
        positionMs: incoming.currentTime * 1000,
        bufferedRangesMs: playbackTimeRanges(incoming.buffered),
        seekableRangesMs: playbackTimeRanges(incoming.seekable),
      });
      if (!sampled || !timeline.established) return abandon('incoming-timeline-unestablished');

      // Wait for the join point to be *buffered* before seeking to it.
      //
      // `canplay` means the first fragment arrived, not that the join is
      // reachable — the join sits `clockOffsetMs` into the replacement, which is
      // however far the viewer travelled while core was negotiating. Seeking
      // there before it is resident makes the element wait for data instead of
      // firing `seeked`, and the handover times out holding a perfectly good
      // replacement. Measured doing exactly that: a 4.8 s join, an 8 s budget,
      // and an abandoned handover with 46 s of runway still in hand.
      //
      // The join is recomputed each turn because the outgoing element keeps
      // moving; a point chosen once goes stale while the data is still arriving.
      let joinAtOldMs = 0;
      let targetMediaMs: number | undefined;
      let bufferDeadline = performance.now() + HANDOVER_BUFFER_TIMEOUT_MS;
      let bufferLastSeenMs = livePositionMs();
      let bufferLastAdvancedAt = performance.now();
      // Where the race stood when it began, so that whether the replacement is
      // gaining on the join can be measured rather than waited out. Taken on
      // the first turn because the join is only computed inside the loop.
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
          // The viewer has not reached the generation yet. Nothing here is a
          // race and no budget runs: both start when the join enters it.
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
        // Resident is not enough on its own. Cutting the moment the join
        // arrives promotes an element holding almost nothing beyond it, and it
        // starves seconds later — the viewer sees the picture come back and
        // then drop again, which reads worse than the single gap it replaced.
        // So the replacement must also hold a little road ahead of the join
        // before it is worth showing.
        const aheadOfJoinMs = playbackTimeRanges(incoming.buffered)
          .filter((range) => range.startMs <= targetMediaMs! && range.endMs >= targetMediaMs!)
          .reduce((ahead, range) => Math.max(ahead, range.endMs - targetMediaMs!), 0);
        // Unless the outgoing element has already stopped, in which case the
        // viewer is looking at a frozen picture and the margin is a luxury.
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
        // Give up as soon as the race is decided, rather than at the budget.
        // The budget's own reasoning — that waiting costs nothing because the
        // viewer is still watching the outgoing source — holds only while the
        // wait can end in a handover. Once the join is receding faster than the
        // replacement fills, the whole budget is spent on an outcome that
        // cannot happen, and the viewer pays for it twice: once in the delay
        // and again in the rewind the fallback lands on.
        const bufferedEndMs = playbackTimeRanges(incoming.buffered)
          .reduce((end, range) => Math.max(end, range.endMs), 0);
        const deficitMs = targetMediaMs - bufferedEndMs;
        if (convergenceStartedAt === undefined) {
          convergenceStartedAt = performance.now();
          convergenceStartDeficitMs = deficitMs;
        }
        const observedMs = performance.now() - convergenceStartedAt;
        // Only while the join is still out of reach. A replacement that holds
        // the join and is merely short of the margin ahead of it is one this
        // loop can still promote — on a stalled outgoing element it does
        // exactly that — so it is not something to throw away for being slow.
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

      // Wait for the outgoing element to actually arrive at the join point, so
      // the cut is where it was planned rather than wherever the seek landed.
      //
      // Unless it stops arriving. A generation whose source is gone runs out of
      // buffer, and then the position it was supposed to reach never comes —
      // measured stalling here for 25 s with a fully prepared replacement
      // sitting a few frames away, which is far worse than the gap it was
      // avoiding. So a stalled outgoing element ends the wait immediately and
      // the cut happens where it stopped: a few hundred milliseconds of skip is
      // the cheapest outcome available once the picture has already frozen.
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
   * Pause on the last frame through a relocation, instead of blanking the
   * element — a seek the node has to build a generation for, or a mode the
   * viewer has just chosen.
   *
   * Measured live 2026-09-18, every out-of-buffer seek: the element went to
   * `readyState` 0 with nothing buffered and `paused` **false** throughout, so
   * it was trying to play with no media — a black screen for as long as the node
   * took, 1.2 s on a fast remux and 10–13 s on a transcode.
   *
   * The old frame cannot survive on the element hls.js is attaching to, so the
   * replacement is prepared on a second one while the outgoing element stays
   * exactly where it is, paused. This differs from the design rejected for
   * relocations above in the one way that matters: that one kept *playing* the
   * outgoing generation, so the viewer watched the previous scene while the
   * clock read the destination. A frozen frame claims nothing.
   *
   * The replacement is loaded from the generation's own start and then seeked to
   * the offset, which is exactly what the teardown path does — the same origin
   * rules, on a hidden element. Pointing hls.js's `startPosition` at the offset
   * would save fetching the pre-roll, but it changes where the media clock
   * begins and that is a separate question from this one.
   *
   * A representation change arrives here too, and on 2026-09-20 it was the
   * expensive one: selecting Transcode from Direct Play blanked the picture for
   * 16.5 s, because the rule asked the outgoing side to be a manifest as well.
   * `canHoldThroughRelocation()` owns that rule now and asks only what the
   * replacement needs.
   *
   * Declines to anything it cannot do cleanly and the caller falls through to
   * the teardown path, so this is never worse than the behaviour it replaces.
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

    // Usually already frozen: the control holds the picture the moment the seek
    // is asked for, which is a whole negotiation earlier than this. Taken here
    // too for the relocations that do not come from a control — a failover, or a
    // coordinator too old to hold anything. `wantsPlayback` goes with it so no
    // readiness event on the outgoing element can quietly start it playing again
    // while it is meant to be held.
    const restoreIntent = this.pictureHold?.resumeWanted ?? this.wantsPlayback;
    this.pictureHold = { resumeWanted: restoreIntent };
    outgoing.pause();
    this.wantsPlayback = false;
    // A hold no control asked for — a mode switch, a failover — arrives with the
    // stall budget still armed, and a picture frozen on purpose reads to it
    // exactly like a node that has died. `holdPicture()` stands it down for the
    // same reason and records what it cost when nobody did; core re-arms on the
    // first report after playback advances again, so nothing is switched off.
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

      // Same rules as the teardown path: the loader began at the generation's
      // own start, so the first resident timestamp is the origin.
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
    // Silence the outgoing element before the incoming one speaks, so the join
    // is never two soundtracks at once.
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
    // The replacement is up, so whatever froze the outgoing picture is spent.
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

    // The outgoing generation is released after the cut, never before it — and
    // so is a failed one that was kept alive to hold the picture until now.
    try { outgoingHls?.destroy(); } catch { /* the element is going anyway */ }
    this.destroyRetiredHls();
    outgoing.removeAttribute('src');
    outgoing.load();
    outgoing.remove();
    // The outgoing side can be Direct Play — a mode switch promotes a transcode
    // over one — and then it left a read-ahead behind it. The teardown path
    // releases this on its way past; the cut has to do it too, or the worker
    // goes on fetching a source nothing will ever play again.
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
      // A disabled TextTrack is not required to fetch. Put it in hidden mode
      // immediately, then make it visible only once the browser has parsed it.
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
      // Do not mark the parser as an active subtitle track: a concurrent
      // selection clears active tracks, while this parser must be allowed to
      // finish so its awaiting promise can settle and observe the generation.
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
      // Hidden starts the browser's WebVTT parser without rendering this
      // temporary track. Parsed cues are copied into one stable display track.
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
      // Keep the immediately preceding segment so a cue may cross a segment
      // boundary, and prefetch the next segment before playback reaches it.
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

    // Prime the window before waiting for the current segment. If playback
    // moves while it loads, repeat once for the new current segment.
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

    // Retain compatibility with older servers which expose one monolithic VTT.
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
    // Paused is not stalled. The stall budget measures a viewer waiting on a
    // picture that will not move, and a pause is the one case where the picture
    // is not moving because they said so — so the countdown is stood down here
    // rather than left to expire against nobody. Without this a pause reliably
    // ended in a failure screen seven seconds later, on a node that was fine.
    //
    // Stood down, not switched off: core re-arms on the first report after the
    // resume, so a node that dies mid-pause is still judged the moment anyone
    // is waiting on it again.
    this.stallWatchdog.suspend();
    // Pause is presentation intent, not source teardown. Managed HLS and the
    // Direct Play worker continue filling their bounded forward buffers.
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
   * Put a managed-HLS load back on the road after a pause parked it.
   *
   * The restart is the same call the judged path makes for `restart-network`,
   * and it is deliberately made before `requestPlay`: whatever killed the load
   * is about to be met again, and it should be met while the viewer is waiting,
   * which is the state in which this client knows what to do about it.
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
        // AbortError is normal when another media operation supersedes play().
        // NotSupportedError/HAVE_NOTHING commonly means hls.js has not attached
        // its MediaSource yet; loadedmetadata/loadeddata/canplay will retry.
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
   * Freeze the picture the instant a seek is asked for, before anyone knows
   * whether it needs a new generation.
   *
   * The player is told nothing at the moment of a seek: core decides locally
   * whether the target is covered, and the first the player hears of a
   * relocation is `play()`, which arrives after the node has answered — 420 ms
   * on a fast remux, 10–13 s on a transcode. For all of that the outgoing
   * generation keeps playing a scene the viewer has already left.
   *
   * So the hold is taken optimistically by the control and released by whichever
   * path core actually takes: `seek()` for a target inside the buffer, which
   * core calls synchronously, so an unnecessary hold is undone in the same tick
   * and never reaches a frame; `holdThroughRelocation` for one outside it, which
   * carries the freeze through to the swap.
   */
  holdPicture(): void {
    const video = this.video;
    if (!video || this.pictureHold || video.paused) return;
    this.pictureHold = { resumeWanted: this.wantsPlayback };
    this.wantsPlayback = false;
    // Stood down for the same reason `pause()` stands it down: the picture has
    // stopped because we stopped it, and a countdown measuring "nothing is
    // moving" cannot tell that from a node that has died. Left running it
    // expires against a freeze we asked for — measured 2026-09-18, a seek held
    // at 51.2 s reported `source-terminal-failure` at 58.1 s, 6,864 ms later,
    // while the node was still building the replacement it delivered at 61.0 s.
    // Core re-arms on the first report after playback advances again, so a node
    // that dies during the hold is still judged the moment anyone is waiting.
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
    // Synchronously refresh the same normalized snapshot published to the UI.
    // This gives local-seek admission and the buffer indicator one authority.
    this.publish(video);
    return this.lastPublishedEvent?.bufferedRangesMs ?? [];
  }

  seek(positionMs: number): void {
    const video = this.video;
    if (!video) {
      this.log.warn('local-seek-without-media', { positionMs });
      return;
    }
    // Core reached here, so the target is inside the buffer after all and the
    // hold taken at the control is not needed. Released before the seek so the
    // element is already running when it lands.
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
   * Record what this element does between being given a source and showing a
   * frame, and say so in one line if that was slow or never happened.
   *
   * For the `readyState` 0 P0 (`TODO/ACTIVE.md`): the stall raises nothing
   * until something else gives up, so the evidence has to be gathered from
   * before `src` is set rather than reconstructed afterwards. Covers managed
   * HLS as well as element-owned fetches, and the standby elements of a
   * handover and a relocation hold as well as the one on screen: the start
   * watchdog only watches the element-owned path, and a handover standby sat
   * at `readyState` 0 for 16 s on the first live node move (2026-09-23) with
   * nothing recording it.
   *
   * Observes only. It never fails, degrades or retries anything; the
   * watchdogs own those decisions.
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
    // An observer rather than `getEntriesByType`: the page's Resource Timing
    // buffer holds 250 entries and was measured full eleven seconds after
    // load, after which the buffer answers nothing new and a start that sent
    // twenty requests reads as one that sent none. An observer is not bound
    // by the buffer. Where there is none, the record says unknown.
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
    // Warn, so the Samsung build keeps it: that is the one target that cannot
    // be watched any other way.
    if (record && shouldReportStart(record)) this.log.warn('source-start-record', record);
  }

  /**
   * Bound a source that the element accepted and then never got a byte from.
   *
   * Reported as a `'stream'` failure because that is exactly what it is —
   * evidence about this node's delivery, not about the media or the decoder —
   * and because `isEndpointRetryablePlaybackFailure` accepts that kind, so the
   * coordinator recovers onto another node instead of showing a dead end.
   * Failing over rather than degrading is deliberate: a degradation prepares a
   * standby, which for Direct Play resolves to a silent swap inside the
   * read-ahead worker, and swapping the bytes underneath an element that has
   * not asked for any would change nothing. Only a fresh `play()` re-runs the
   * media load algorithm, which is what actually breaks this deadlock.
   */
  private watchForStarvedStart(video: HTMLVideoElement, source: PlaybackSource, sourceGeneration: number): void {
    this.startWatchdog.start((visibleMs) => {
      if (sourceGeneration !== this.sourceGeneration || video !== this.video) return;
      const readAhead = directPlayReadAheadMetrics(this.directReadAheadSourceUrl);
      // The distinction that cost an evening of live debugging to make by
      // hand, recorded here automatically. When the read-ahead worker is in
      // the path it sees every request the renderer actually dispatched, so
      // it separates "the browser never asked" from "the node never
      // answered" — and those have nothing in common but the symptom.
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
   * Bound a generation whose picture has frozen with nothing arriving.
   *
   * Reported as `'stream'`, the same kind the element's own `error` event
   * produces, so it reaches the failover the coordinator already performs. On
   * a platform whose player reports nothing this is the only thing that will
   * ever say so: a Samsung set held a frozen frame for thirty seconds with
   * every recovery mechanism intact and idle, because its native HLS player
   * swallowed the failure and never raised `MediaError`.
   */
  private watchForStall(video: HTMLVideoElement, source: PlaybackSource, sourceGeneration: number): void {
    // Take the stall budget from the node serving *this* source. The watchdog
    // outlives any one generation while the figure belongs to a node, so it is
    // set here — at the one place every attach path passes through — rather
    // than at each of them, where a new path would forget it. A node
    // configured with a longer hold than the compiled-in default was being
    // called dead for answering at its own frontier.
    this.stallWatchdog.useSourceBudgets(source);
    this.stallWatchdog.watch(({ visibleMs, positionMs, bufferedEndMs }) => {
      if (sourceGeneration !== this.sourceGeneration || video !== this.video) return;
      const detail = {
        ...videoState(video),
        visibleMs,
        stalledAtMs: Math.round(positionMs),
        // Absent stays absent all the way to the log line. A player that
        // cannot measure buffering is not a player whose buffer is at zero,
        // and rounding `undefined` into the record would invent the one
        // figure that separates a slow node from a dead one.
        bufferedEndMs: bufferedEndMs === undefined ? undefined : Math.round(bufferedEndMs),
        mode: source.mode,
        url: source.url,
      };
      // A generation already known to be gone has an explanation for its own
      // stall, and it is not the node's fault. Reporting `stream` here would
      // charge an endpoint that is answering correctly for the silence of a
      // source it no longer has — and would tear down the buffer the recovery
      // is running inside, which is the whole point of not doing that above.
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
   * A source the node has no record of, reported once per generation on its own
   * latch rather than the shared one.
   *
   * Separate because the shared latch would swallow it. Ordinary degradation
   * fires at most once per generation to keep repeated network wobble from
   * spamming the coordinator — so a generation that had already seen one
   * transient error would never report the 404 that followed, and the whole
   * early recovery would be lost to a blip that had nothing to do with it.
   * These are different claims: one says the node is struggling, the other says
   * this source is gone, and only the second is recoverable in place.
   */
  private degradeSourceNotFound(sourceGeneration: number, error: Error, detail?: unknown): void {
    if (sourceGeneration !== this.sourceGeneration || this.notFoundSourceGeneration === sourceGeneration) return;
    this.notFoundSourceGeneration = sourceGeneration;
    this.log.warn('source-not-found', { error, detail });
    for (const listener of this.degradationListeners) listener(error);
  }

  /**
   * Report that the node no longer has this source, and do nothing else.
   *
   * **The one failure this player does not act on.** Everywhere else a terminal
   * failure means the presentation is over, so `failSourceGeneration` destroys
   * hls.js, pauses the element and drops the viewer's intent. That is right for
   * a stream this browser cannot decode and wrong for a session the node has
   * simply forgotten: the bytes already in the element are still good, still
   * playing, and are the entire budget the coordinator has to recover inside.
   *
   * Measured before this existed: the teardown ran 6 ms after the fatal and
   * took 61.5 s of playable video with it, so a recovery that had a minute to
   * work in got none, and the viewer's picture froze for 12.7 s. hls.js gives
   * up about 28 s after a source goes away, which is always sooner than a full
   * buffer drains — so without this the coordinator is never allowed to choose
   * its own moment, and the swap is always forced by the loader rather than
   * timed by the runway.
   *
   * Core owns what the viewer is told from here, and has taken that on
   * explicitly: if there is no replacement it sets the fatal error and stops
   * the player. This player's job is to say what happened and keep the picture
   * up meanwhile.
   *
   * Latched separately from `failedSourceGeneration`, deliberately. This is not
   * a terminal failure, so it must not consume the one that comes after it — a
   * generation whose source went away can still go on to raise a genuine decode
   * failure, and that one does end the presentation.
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
    // Stopped, not destroyed: it must fetch nothing more from a node that has
    // just failed, and it must keep the last frame on screen until something
    // can replace it. `retiredHls` is destroyed by whichever path takes the
    // element next.
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
   *   False while a replacement generation is being prepared on its own element:
   *   the handlers below all guard on `this.hls !== hls`, so an uninstalled
   *   instance loads and buffers while judging nothing, and starts being
   *   listened to at the moment it is promoted.
   */
  private attachHls(
    Hls: typeof import('hls.js').default,
    video: HTMLVideoElement,
    url: string,
    sourceGeneration: number,
    install = true,
    startPositionMs?: number,
  ): { hls: InstanceType<typeof import('hls.js').default>; recovery: ManagedHlsMediaRecoveryBudget } {
    // hls.js's own startPosition seeks in raw source-local seconds and does not
    // know about mediaOriginMs; the initial-seek listener above is the sole
    // owner of the resume seek so hls.js and the app never race the same
    // MediaSource with two independent seeks to (possibly) different targets.
    //
    // A handover is the one case where it is both safe and necessary. The
    // replacement is not presented and nothing else will seek it, and the join
    // is several seconds in — so loading from zero fetches every fragment
    // before the join and throws them away. Measured: 9.03 s of a 9.54 s
    // handover was that fetch. Starting the loader at the join asks for the one
    // fragment the cut actually needs.
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
      // errors are exactly what a start that never arrives needs on record.
      this.startRecorders.get(video)?.recorder.hlsError(data as Parameters<StartRecorder['hlsError']>[0]);
      if (sourceGeneration !== this.sourceGeneration || this.hls !== hls) return;
      const payload = { data: hlsEventSummary(data), state: videoState(video) };
      // The earliest and cheapest recovery this client has. hls.js populates
      // `response.code` on the *nonfatal* fragment errors, so a source the node
      // no longer has is knowable while the buffer built before it went away
      // still has a minute to run — measured at 62.8 s of cover, and the first
      // of these arrived 3.7 s before the viewer even pressed play. Reported on
      // the degradation channel so the coordinator can regenerate on this node
      // inside that margin and the viewer sees nothing at all.
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
      // Sample the normalized generation-local clock before the recovery policy
      // decides whether another media-pipeline recovery is permitted.
      if (data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR) this.publish(video);
      const action = managedHlsErrorAction(
        data,
        mediaRecovery,
        this.lastPublishedEvent?.positionMs ?? 0,
        video.buffered.length > 0,
        // Viewer intent, not the element's state. Between a play request and
        // the element actually running, `video.paused` is still true while the
        // viewer is very much waiting — and that window is exactly when a node
        // that refuses the stream must be judged rather than excused.
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
        // Logged as a warning and kept out of the failure channel entirely.
        // Nothing is torn down and no budget is spent; `resume()` picks the
        // load back up and the same error, if it is still true, is judged then.
        this.log.warn('hls-load-parked-while-paused', { ...payload, details: action.details });
        this.hlsLoadParkedWhilePaused = true;
        hls.stopLoad();
        return;
      }
      if (action.action === 'fail-not-found') {
        // Reported as `not-found` so the coordinator regenerates on this node
        // rather than condemning it. The node is answering correctly and is the
        // one holding this title's pipeline; the source it was asked for is
        // simply not there any more. No network restart was spent getting here,
        // and nothing is torn down — the element keeps playing what it has.
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
        // A generation that only ever answered "not produced yet" has not
        // given us evidence against the node, however many times it said it.
        // Reported as `not-ready` so the core neither prepares a standby nor
        // fails over: a replacement node would begin its own generation from
        // nothing, which is slower than the one already being produced. The
        // viewer still gets a stated failure rather than an endless spinner,
        // which is the part that must not be given up.
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

  private publish(video: HTMLVideoElement): void {
    const timeline = this.mediaTimeline;
    if (!timeline || video !== this.video) return;

    const rawBufferedRangesMs = playbackTimeRanges(video.buffered);
    const normalized = timeline.sample({
      positionMs: video.currentTime * 1000,
      bufferedRangesMs: rawBufferedRangesMs,
      seekableRangesMs: playbackTimeRanges(video.seekable),
    });
    // During a transformed source swap the reused <video> element can emit
    // teardown/readiness events before the new generation establishes its MSE
    // timestamp origin. Suppress those ambiguous observations rather than
    // interpreting them on the wrong generation timeline.
    if (!normalized) return;

    // Playing versus arriving. `note()` judges nothing on its own — it needs
    // both, because a node producing below realtime freezes the picture while
    // the buffer keeps filling, and that is a slow node rather than a dead one.
    if (!video.paused) {
      const bufferedEndMs = normalized.bufferedRangesMs.reduce((end, range) => Math.max(end, range.endMs), 0);
      this.stallWatchdog.note(normalized.positionMs, bufferedEndMs);
    }

    const duration = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
    const currentMs = normalized.positionMs;
    const forwardBufferMs = forwardBufferMsAt(currentMs, normalized.bufferedRangesMs);
    this.hlsMediaRecovery?.observePlaybackPosition(
      currentMs,
      !video.paused && !video.ended && !video.seeking,
    );
    // Read once and used twice below. Undefined for a transformed source or
    // where the worker never registered, which is the distinction the event
    // carries downstream.
    const readAheadMetrics = directPlayReadAheadMetrics(this.directReadAheadSourceUrl);
    const event: PlaybackEvent = {
      // Whole milliseconds, because this number leaves the client: it is kept as
      // the resume position and goes back to the node as `seekMs`, and the seek
      // contract is stated in integer milliseconds with no rounding slack.
      //
      // Sub-millisecond precision here stops playback dead. Asked for
      // 2,018,389.921 ms the node answers with a generation starting at
      // 2,018,390, core reads `absolute < generationStart` as "this generation
      // begins after the viewer", refuses to activate, and re-asks with the same
      // fractional number for ever. Measured 2026-09-18: 25 identical
      // negotiation rounds, no error raised, and `player.play()` never called at
      // all. It bites only when the node honours the exact position and rounds
      // up — a frame-accurate transcode — which is why it comes and goes.
      //
      // The element's own clock keeps its full precision; only what is published
      // is rounded.
      positionMs: Math.round(currentMs),
      // Floored, not rounded, and for a different reason than the position.
      // This figure reaches `localStorage` through Continue Watching, and it is
      // the scrubber's `max` — the one value an `<input type="range">` hands
      // back off its own step grid, so dragging to the far right commits
      // exactly this number as a seek. A duration must never claim media the
      // element does not have, because a seek to the end is clamped against it.
      durationMs: Math.floor(duration),
      paused: video.paused,
      ended: video.ended,
      seeking: video.seeking,
      buffering: !video.paused
        && !video.ended
        && (video.seeking || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA),
      bufferedRangesMs: wholeMillisecondRanges(normalized.bufferedRangesMs),
      forwardBufferMs: Math.round(forwardBufferMs),
      streamOrigin: readAheadMetrics?.sourceOrigin || undefined,
      // The worker's cover, which `forwardBufferMs` cannot see: that is
      // `video.buffered` only, and on Direct Play the element has taken a
      // fraction of what the cache holds in front of it. `aheadBytes` is
      // measured beyond `lastServedOffset`, which is what "beyond what the
      // element has taken" means.
      //
      // Spread so the key is **absent** rather than zero when there is no
      // read-ahead at all — no worker, or a transformed source. Core reads
      // absent as "this host has no such cache" and zero as "it holds
      // nothing", and on a transformed generation the second would be a claim
      // about a cache that does not exist.
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
  // `readAheadBytes` is deliberately **not** compared, which looks like an
  // omission and is not. It changes on every prefetch response, so comparing
  // it would make almost every sample a new event and turn a dedupe into a
  // firehose — on the one path that is already moving the most bytes. It rides
  // along on events published for a reason that matters, recomputed each time,
  // so it is never older than the event carrying it.

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

  async capabilities(): Promise<PlaybackCapabilities> {
    const video = document.createElement('video');
    const probe = (mime: string) => supportedMime(video, mime);
    const mediaFeature = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? (query: string) => window.matchMedia(query).matches
      : undefined;
    // Whichever decoder will actually be handed the stream is the one whose
    // opinion counts, and it is never the media element's progressive-file
    // answer. hls.js means MediaSource; the native player means the engine's
    // own view of the playlist type. Asking the wrong one is how a codec the
    // element plays perfectly well arrives broken through HLS.
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
      // Asked, not assumed. Supporting HLS says nothing about which segment
      // packaging works: an older set can be solid on MPEG-TS and broken on
      // fMP4, which is the difference between a stream that plays and one
      // that black-screens.
      hlsTs: detectHlsTsSupport(probe) || managedHlsSupported(),
      dash: false,
      // Both of these gate what the server will hand over. Over-claiming is
      // the dangerous direction: an over-claimed depth or transfer is a black
      // screen, an under-claimed one is only a transcode nobody needed.
      hdr: hdrTransfers,
      videoBitDepth,
      // What the delivery decoder will accept, which is not always what the
      // media element accepts. Equal to the element's list unless the delivery
      // probe disagreed, so a host with one decoder for both paths is
      // unaffected. Sent only when they differ: an identical list is noise,
      // and the chooser already falls back to the element's answer.
      ...(hlsVideoCodecs.length !== videoCodecs.length ? { hlsVideoCodecs } : {}),
      ...(hlsAudioCodecs.length !== audioCodecs.length ? { hlsAudioCodecs } : {}),
      // Omitted when empty: absent and empty mean the same thing, and neither
      // is ever read as "capable".
      ...(dolbyVision.length > 0 ? { dolbyVision } : {}),
    };
    // Only where hls.js would actually drive playback: the Samsung and
    // Android builds force the native player, so they never fetch it at all.
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
   * Freeze the picture for a seek that is about to need a new generation.
   *
   * Reached from the control rather than from the coordinator, because the
   * coordinator tells a player nothing until the replacement exists and the
   * point of this is to act before that. The runtime keeps its player private,
   * so the platform that made it is the one thing both sides can see.
   */
  holdPicture(): void {
    this.activePlayer?.holdPicture();
  }

  /** Undo a hold whose seek turned out to be servable from the buffer. */
  releasePicture(): void {
    this.activePlayer?.releasePicture();
  }
}
