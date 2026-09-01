import Hls from 'hls.js';
import { createClientLogger } from '../diagnostics/ClientLog';
import {
  PlaybackSourceError,
  type Platform,
  type PlaybackDegradationListener,
  type PlaybackFailureListener,
  type PlaybackListener,
  type Player,
} from './Platform';
import type { MediaTechnicalProfile, PlaybackCapabilities, PlaybackEvent, PlaybackSource, PlaybackTimeRange } from '../types';
import { ManagedHlsMediaRecoveryBudget } from './ManagedHlsRecovery';
import { detectWebMediaCodecCapabilities } from './WebMediaCapabilities';
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
import { isHlsNetworkDegradation, managedHlsErrorAction, webHlsBufferConfig } from './WebHlsPolicy';
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

function isHls(source: PlaybackSource): boolean {
  return source.mimeType === 'application/vnd.apple.mpegurl' || /\.m3u8(?:$|[?#])/i.test(source.url);
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
  if (!response.ok || !response.body) return false;
  const reader = response.body.getReader();
  try {
    const first = await reader.read();
    return !first.done && Boolean(first.value?.byteLength);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Validate a playlist and its initial fMP4 data without attaching a decoder. */
export async function preflightWebHlsSource(
  source: PlaybackSource,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<boolean> {
  if (!isHls(source)) return false;
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
  private failedSourceGeneration?: number;
  private degradedSourceGeneration?: number;
  private unsubscribeDirectDegradation?: () => void;
  private hlsMediaRecovery?: ManagedHlsMediaRecoveryBudget;
  private mediaTimeline?: WebMediaTimeline;
  private lastPublishedEvent?: PlaybackEvent;

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
      const failure = webMediaElementFailure(video.error);
      this.failSourceGeneration(this.sourceGeneration, failure, videoState(video));
    });
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
    this.wantsPlayback = !startPaused;
    // Suppress media-element teardown events from the previous source. The new
    // generation timeline must not observe or learn an origin from old buffer
    // residency on the reused <video> element.
    this.activeSource = undefined;
    this.mediaTimeline = undefined;
    this.lastPublishedEvent = undefined;
    this.log.info('source-load-begin', {
      mode: source.mode,
      mimeType: source.mimeType,
      mediaId: source.mediaId,
      url: source.url,
      subtitleUrl: source.subtitleUrl,
      requestedPositionMs: positionMs,
      hls: isHls(source),
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

    const existingVideo = this.video;
    const video = this.ensureMediaElement();
    if (existingVideo) {
      // Keep the media element itself across transformed seek generations.
      // Recreating it forces the browser to rebuild the entire playback DOM
      // and can also drop element-scoped state such as fullscreen/PiP.
      video.pause();
      video.removeAttribute('src');
      video.load();
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

    if (isHls(source)) {
      if (shouldUseManagedHls(this.options.forceNativeHls, Hls.isSupported())) {
        this.log.info('hls-js-selected', { url: source.url });
        this.attachHls(video, source.url, positionMs, sourceGeneration);
      } else if (this.options.forceNativeHls || nativeHlsSupported(video)) {
        this.log.info('hls-native-selected', { url: source.url });
        video.src = source.url;
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
      video.src = directUrl;
    }

    if (sourceGeneration !== this.sourceGeneration || this.failedSourceGeneration === sourceGeneration) return false;
    const playStarted = performance.now();
    if (startPaused) {
      this.stopManagedHlsLoad();
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

  private stopManagedHlsLoad(): void {
    this.hls?.stopLoad();
  }

  pause(): void {
    this.playRequestGeneration += 1;
    this.log.info('pause-request', this.video ? videoState(this.video) : undefined);
    this.wantsPlayback = false;
    setDirectPlayReadAheadMode(this.directReadAheadSourceUrl, 'paused');
    // A paused transport must also quiesce source acquisition. Otherwise hls.js
    // can keep filling its minute-scale buffer and keep the server session hot.
    this.stopManagedHlsLoad();
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
    if (this.hls) this.hls.startLoad(video.currentTime);
    this.requestPlay(video, 'resume');
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
    this.wantsPlayback = false;
    this.activeSource = undefined;
    this.mediaTimeline = undefined;
    this.lastPublishedEvent = undefined;
    this.log.debug('stop', this.video ? videoState(this.video) : undefined);
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

  private degradeSourceGeneration(sourceGeneration: number, error: Error, detail?: unknown): void {
    if (sourceGeneration !== this.sourceGeneration || this.degradedSourceGeneration === sourceGeneration) return;
    this.degradedSourceGeneration = sourceGeneration;
    this.log.warn('source-degraded', { error, detail });
    for (const listener of this.degradationListeners) listener(error);
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

  private attachHls(video: HTMLVideoElement, url: string, positionMs: number, sourceGeneration: number): void {
    const hls = new Hls(webHlsBufferConfig(positionMs));
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
      this.publish(video);
    });
    hls.on(Hls.Events.BUFFER_FLUSHED, () => this.publish(video));
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (sourceGeneration !== this.sourceGeneration || this.hls !== hls) return;
      const payload = { data: hlsEventSummary(data), state: videoState(video) };
      if (isHlsNetworkDegradation(data)) {
        this.degradeSourceGeneration(
          sourceGeneration,
          new PlaybackSourceError(`Web HLS network degradation (${data.details}).`, 'stream', data),
          payload,
        );
      }
      // Sample the normalized generation-local clock before the recovery policy
      // decides whether another media-pipeline recovery is permitted.
      if (data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR) this.publish(video);
      const action = managedHlsErrorAction(data, mediaRecovery, this.lastPublishedEvent?.positionMs ?? 0);
      if (action.action === 'nonfatal') {
        this.log.warn('hls-error-nonfatal', payload);
        return;
      }
      this.log.error('hls-error-fatal', payload);
      if (action.action === 'restart-network') {
        this.log.warn('hls-recovery-network-start-load', { ...payload, attempt: action.attempt });
        if (this.wantsPlayback) hls.startLoad(video.currentTime);
        return;
      }
      if (action.action === 'fail-network') {
        this.failSourceGeneration(
          sourceGeneration,
          new PlaybackSourceError(
            `Web HLS playback failed after bounded network recovery (${action.details}).`,
            'stream',
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
    const { videoCodecs, audioCodecs, containers } = detectWebMediaCodecCapabilities(probe);

    const capabilities: PlaybackCapabilities = {
      platform: 'web',
      videoCodecs,
      audioCodecs,
      containers,
      hls: nativeHlsSupported(video) || Hls.isSupported(),
      dash: false,
      // Do not claim HDR profiles merely because the display is HDR-capable.
      // The server needs a defined codec/profile contract before we advertise them.
      hdr: [],
    };
    this.log.info('detected', {
      platform: capabilities.platform,
      containers: capabilities.containers.join(', '),
      videoCodecs: capabilities.videoCodecs.join(', '),
      audioCodecs: capabilities.audioCodecs.join(', '),
      hlsFmp4: capabilities.hls,
      decoderResolutionLimit: 'none',
      hdr: capabilities.hdr.length > 0 ? capabilities.hdr.join(', ') : 'not-advertised',
    });
    return capabilities;
  }

  createPlayer(): Player {
    return new WebPlayer(this.playerOptions);
  }
}
