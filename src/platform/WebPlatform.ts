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
import type { MediaTechnicalProfile, PlaybackCapabilities, PlaybackEvent, PlaybackSource, PlaybackTimeRange } from '@machafoundation/core';
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
  setDirectPlayReadAheadMode,
  subscribeDirectPlayReadAheadFailure,
} from '../playback/directPlayReadAhead';
import { hlsEventSummary, videoState, WebMediaDiagnostics } from './WebMediaDiagnostics';
import {
  isHlsNetworkDegradation,
  isHlsSegmentHold,
  isHlsSourceNotFound,
  managedHlsErrorAction,
  SEGMENT_NOT_READY_STATUS,
  SOURCE_NOT_FOUND_STATUS,
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

/** Validate a playlist and its initial fMP4 data without attaching a decoder. */
export async function preflightWebHlsSource(
  source: PlaybackSource,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = HLS_PREFLIGHT_TIMEOUT_MS,
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
 * How long a node is given to produce the first fragment of a fresh
 * generation before the wait becomes evidence against it.
 *
 * Generous deliberately. `500 segment_not_ready` is the node stating that it
 * is working on a fragment it has already promised, and abandoning it costs
 * more than waiting does: the replacement starts its own generation from
 * nothing, so the viewer waits out a cold start instead of the tail of a warm
 * one. Thirty seconds is five of the server's own six-second holds.
 */
export const NATIVE_HLS_FIRST_FRAGMENT_TIMEOUT_MS = 30_000;

/** Only reached where the node did not say; a held fragment carries `Retry-After`. */
const NATIVE_HLS_HOLD_RETRY_MS = 500;

/** Longest a single stated `Retry-After` is honoured, so one bad header cannot park playback. */
const NATIVE_HLS_MAX_RETRY_MS = 5_000;

export interface NativeHlsReadiness {
  ready: boolean;
  /** Why not, in the terms the node stated it. */
  reason?: string;
  waitedMs: number;
  attempts: number;
}

type FragmentProbe =
  | { ready: true }
  | { ready: false; hold: boolean; reason: string; retryMs?: number };

function statedRetryMs(response: Response): number | undefined {
  const stated = response.headers.get('Retry-After');
  if (!stated) return undefined;
  const seconds = Number(stated);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1_000, NATIVE_HLS_MAX_RETRY_MS);
}

function refusal(response: Response, what: string): FragmentProbe {
  return {
    ready: false,
    hold: response.status === SEGMENT_NOT_READY_STATUS,
    reason: `${what} answered ${response.status}`,
    retryMs: statedRetryMs(response),
  };
}

async function probeFirstFragment(manifestUrl: string, fetchImpl: typeof fetch): Promise<FragmentProbe> {
  let url = manifestUrl;
  for (let depth = 0; depth < 2; depth += 1) {
    const response = await fetchImpl(url, { method: 'GET', cache: 'no-store' });
    if (!response.ok) return refusal(response, 'playlist');
    const targets = webHlsPreflightTargets(await response.text(), url);
    if (targets.variantUrl) {
      url = targets.variantUrl;
      continue;
    }
    if (targets.mediaUrls.length === 0) return { ready: false, hold: false, reason: 'playlist names no fragment' };
    for (const mediaUrl of targets.mediaUrls) {
      // One byte is the whole question. The node admits and holds this request
      // through the same path as the player's own fragment fetch, so a
      // fragment still being produced answers it exactly as it would answer
      // the player — and a Range this small cannot cost a segment's traffic.
      const media = await fetchImpl(mediaUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store',
      });
      if (!media.ok) return refusal(media, 'fragment');
    }
    return { ready: true };
  }
  return { ready: false, hold: false, reason: 'playlist nests variants past one level' };
}

/**
 * Hold a native HLS source until the node will actually serve its first
 * fragment.
 *
 * A native player has no retry policy this client can reach: hand it a
 * playlist whose first fragment is still being produced and it reports a
 * network failure immediately and permanently. The coordinator can only read
 * that as the node having failed, so it moves to the next one — which
 * cold-starts its own generation and answers the same way. Three of those
 * exhaust a healthy cluster in seconds, which is exactly what the Samsung set
 * does on every failover.
 *
 * hls.js needs none of this because it retries fragments itself and
 * `isHlsSegmentHold` already teaches it that a 500 is not node evidence. This
 * is that same contract honoured on the one path that cannot honour it from
 * inside the player, so it is asked before the element is ever given the URL.
 */
export async function awaitNativeHlsFirstFragment(
  manifestUrl: string,
  options: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    timeoutMs?: number;
    /** Abandons the wait when a later generation has taken over. */
    superseded?: () => boolean;
  } = {},
): Promise<NativeHlsReadiness> {
  const {
    fetchImpl = fetch,
    now = () => Date.now(),
    sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
    timeoutMs = NATIVE_HLS_FIRST_FRAGMENT_TIMEOUT_MS,
    superseded = () => false,
  } = options;
  const started = now();
  const deadline = started + timeoutMs;
  let attempts = 0;
  let reason = 'superseded before the node was asked';
  while (!superseded()) {
    attempts += 1;
    let probe: FragmentProbe;
    try {
      probe = await probeFirstFragment(manifestUrl, fetchImpl);
    } catch (error) {
      // A transfer that never became a response is evidence about the node,
      // never about the fragment, so it is not something to wait out.
      probe = { ready: false, hold: false, reason: error instanceof Error ? error.message : String(error) };
    }
    if (probe.ready) return { ready: true, waitedMs: now() - started, attempts };
    reason = probe.reason;
    if (!probe.hold) break;
    const retryMs = probe.retryMs ?? NATIVE_HLS_HOLD_RETRY_MS;
    if (now() + retryMs >= deadline) {
      reason = `${reason} for ${Math.round((now() - started) / 1_000)}s`;
      break;
    }
    await sleep(retryMs);
  }
  return { ready: false, reason, waitedMs: now() - started, attempts };
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
  private host?: HTMLElement;
  private video?: HTMLVideoElement;
  private hls?: Hls;
  private listeners = new Set<PlaybackListener>();
  private failureListeners = new Set<PlaybackFailureListener>();
  private degradationListeners = new Set<PlaybackDegradationListener>();
  private readonly playerId = ++webPlayerSequence;
  private readonly log = createClientLogger('playback.web', { playerId: this.playerId });
  private readonly diagnostics = new WebMediaDiagnostics(this.log);
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
    this.diagnostics.attach(video, () => this.directReadAheadSourceUrl);

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
    this.video = video;
    const host = this.host;
    if (host) {
      while (host.firstChild) host.removeChild(host.firstChild);
      host.appendChild(video);
    }
    return video;
  }

  async play(source: PlaybackSource, positionMs = 0, startPaused = false): Promise<boolean> {
    if (!this.host) throw new Error('Player must be attached before playback');
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
    this.mediaTimeline = new WebMediaTimeline(source.mode, positionMs);

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
        // at readyState 0 forever, no request issued and no error raised. What
        // that reset was for — a failure from the generation being replaced
        // being charged to its replacement — is handled by
        // `attachedSourceGeneration` instead, which costs the element nothing.
        const readiness = await awaitNativeHlsFirstFragment(source.url, {
          superseded: () => sourceGeneration !== this.sourceGeneration,
        });
        if (sourceGeneration !== this.sourceGeneration || video !== this.video) return false;
        // Warned rather than logged when it actually had to wait: a wait is
        // the node at its production frontier and worth seeing, and the
        // Samsung build keeps `warn` and above, which is the one target that
        // cannot be watched any other way.
        const waited = { url: source.url, ...readiness };
        if (readiness.attempts > 1) this.log.warn('hls-native-first-fragment-held', waited);
        else this.log.info('hls-native-first-fragment', waited);
        if (!readiness.ready) {
          this.failSourceGeneration(
            sourceGeneration,
            new PlaybackSourceError(`The node did not serve the first fragment: ${readiness.reason}.`, 'stream'),
            readiness,
          );
          return false;
        }
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
          // a reaped session, or a range past the end of what it covers — and
          // it is not evidence against the node. Without this the worker's
          // failure arrives as `stream`, the node is condemned for answering
          // honestly, and a session that only needed re-creating takes the
          // viewer to a failure screen naming somewhere else entirely.
          if (error.status === SOURCE_NOT_FOUND_STATUS) {
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
    this.startWatchdog.stop();
    this.stallWatchdog.stop();
    this.hls?.destroy();
    this.hls = undefined;
    this.hlsMediaRecovery = undefined;
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
    const hls = this.hls;
    this.hls = undefined;
    this.hlsMediaRecovery = undefined;
    hls?.destroy();
    this.video?.pause();
    for (const listener of this.failureListeners) listener(error);
  }

  private attachHls(Hls: typeof import('hls.js').default, video: HTMLVideoElement, url: string, sourceGeneration: number): void {
    // hls.js's own startPosition seeks in raw source-local seconds and does not
    // know about mediaOriginMs; the initial-seek listener above is the sole
    // owner of the resume seek so hls.js and the app never race the same
    // MediaSource with two independent seeks to (possibly) different targets.
    const hls = new Hls(webHlsBufferConfig());
    const mediaRecovery = new ManagedHlsMediaRecoveryBudget();
    this.hls = hls;
    this.hlsMediaRecovery = mediaRecovery;
    const attachedAt = performance.now();

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
    hls.on(Hls.Events.FRAG_LOADING, (_event, data) => this.log.debug('hls-fragment-loading', hlsEventSummary(data)));
    hls.on(Hls.Events.FRAG_LOADED, (_event, data) => this.log.debug('hls-fragment-loaded', hlsEventSummary(data)));
    hls.on(Hls.Events.FRAG_BUFFERED, (_event, data) => {
      this.log.debug('hls-fragment-buffered', { data: hlsEventSummary(data), state: videoState(video) });
      mediaRecovery.observeBufferedContent();
      this.publish(video);
    });
    hls.on(Hls.Events.BUFFER_FLUSHED, () => this.publish(video));
    hls.on(Hls.Events.ERROR, (_event, data) => {
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
    let forwardBufferMs = 0;
    for (const range of normalized.bufferedRangesMs) {
      if (range.startMs <= currentMs + 250 && range.endMs >= currentMs) {
        forwardBufferMs = Math.max(forwardBufferMs, range.endMs - currentMs);
      }
    }
    this.hlsMediaRecovery?.observePlaybackPosition(
      currentMs,
      !video.paused && !video.ended && !video.seeking,
    );
    const event: PlaybackEvent = {
      positionMs: currentMs,
      durationMs: duration,
      paused: video.paused,
      ended: video.ended,
      seeking: video.seeking,
      buffering: !video.paused
        && !video.ended
        && (video.seeking || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA),
      bufferedRangesMs: normalized.bufferedRangesMs,
      forwardBufferMs,
      streamOrigin: directPlayReadAheadMetrics(this.directReadAheadSourceUrl)?.sourceOrigin || undefined,
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
    return new WebPlayer(this.playerOptions);
  }
}
