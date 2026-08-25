import Hls from 'hls.js';
import { createClientLogger } from '../diagnostics/ClientLog';
import type { Platform, PlaybackListener, Player } from './Platform';
import type { PlaybackCapabilities, PlaybackSource, PlaybackTimeRange } from '../types';
import { detectWebMediaCodecCapabilities } from './WebMediaCapabilities';
import {
  directPlayReadAheadMetrics,
  directPlayReadAheadUrl,
  releaseDirectPlayReadAhead,
  setDirectPlayReadAheadMode,
} from '../playback/directPlayReadAhead';

interface SubtitleSegmentManifest {
  format: 'macha-webvtt-segments';
  version: number;
  stream_index: number;
  segment_durations_ms: number[];
}

function isLegacyWebVtt(url: string): boolean {
  return /\.vtt(?:$|[?#])/i.test(url);
}

function validSubtitleManifest(value: unknown): value is SubtitleSegmentManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<SubtitleSegmentManifest>;
  return manifest.format === 'macha-webvtt-segments'
    && manifest.version === 1
    && Number.isInteger(manifest.stream_index)
    && Array.isArray(manifest.segment_durations_ms)
    && manifest.segment_durations_ms.length > 0
    && manifest.segment_durations_ms.every((duration) => Number.isFinite(duration) && duration > 0);
}

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

function nativeHlsSupported(video: HTMLVideoElement): boolean {
  return video.canPlayType('application/vnd.apple.mpegurl') !== '' || video.canPlayType('application/x-mpegURL') !== '';
}

export function shouldUseManagedHls(forceNativeHls: boolean | undefined, managedSupported: boolean): boolean {
  return forceNativeHls !== true && managedSupported;
}

export function webHlsBufferConfig(positionMs: number): Record<string, number | boolean> {
  return {
    enableWorker: true,
    // Local Macha VOD should keep ordinary navigation in browser memory while
    // retaining a hard byte ceiling for very high bitrate sources.
    maxBufferLength: 60,
    maxMaxBufferLength: 120,
    maxBufferSize: 128 * 1024 * 1024,
    backBufferLength: 30,
    startPosition: Math.max(0, positionMs / 1000),
  };
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

function ranges(rangesValue: TimeRanges): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < rangesValue.length; index += 1) {
    out.push({
      start: Math.round(rangesValue.start(index) * 1000) / 1000,
      end: Math.round(rangesValue.end(index) * 1000) / 1000,
    });
  }
  return out;
}

function readyStateName(value: number): string {
  return ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'][value] ?? String(value);
}

function networkStateName(value: number): string {
  return ['NETWORK_EMPTY', 'NETWORK_IDLE', 'NETWORK_LOADING', 'NETWORK_NO_SOURCE'][value] ?? String(value);
}

function mediaError(video: HTMLVideoElement): Record<string, unknown> | undefined {
  const error = video.error;
  if (!error) return undefined;
  return { code: error.code, message: error.message };
}

function videoState(video: HTMLVideoElement): Record<string, unknown> {
  return {
    currentTime: Math.round(video.currentTime * 1000) / 1000,
    duration: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) / 1000 : video.duration,
    paused: video.paused,
    ended: video.ended,
    seeking: video.seeking,
    readyState: readyStateName(video.readyState),
    networkState: networkStateName(video.networkState),
    buffered: ranges(video.buffered),
    seekable: ranges(video.seekable),
    playbackRate: video.playbackRate,
    currentSrc: video.currentSrc,
    error: mediaError(video),
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function hlsEventSummary(value: unknown): Record<string, unknown> {
  const data = objectValue(value);
  const frag = objectValue(data.frag);
  const response = objectValue(data.response);
  const stats = objectValue(data.stats ?? frag.stats);
  return {
    type: data.type,
    details: data.details,
    fatal: data.fatal,
    level: data.level ?? frag.level,
    sn: frag.sn,
    start: frag.start,
    duration: frag.duration,
    url: data.url ?? frag.url,
    response: Object.keys(response).length > 0 ? {
      code: response.code,
      text: response.text,
      url: response.url,
    } : undefined,
    stats: Object.keys(stats).length > 0 ? {
      loaded: stats.loaded,
      total: stats.total,
      aborted: stats.aborted,
      loading: stats.loading,
      parsing: stats.parsing,
      buffering: stats.buffering,
    } : undefined,
  };
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
  private readonly playerId = ++webPlayerSequence;
  private readonly log = createClientLogger('playback.web', { playerId: this.playerId });
  private lastTimeLogMs = 0;
  private lastProgressLogMs = 0;
  private initialSeekCleanup?: () => void;
  private subtitleGeneration = 0;
  private subtitleCleanup?: () => void;
  private subtitleTextTrack?: TextTrack;
  private volume = 1;
  private directReadAheadSourceUrl?: string;
  private wantsPlayback = false;
  private playRequestGeneration = 0;
  private activeSource?: PlaybackSource;

  constructor(private readonly options: WebPlayerOptions = {}) {}

  attach(host: HTMLElement): void {
    this.host = host;
    this.log.debug('attach');
  }

  detach(): void {
    this.log.debug('detach');
    this.stop();
    this.host = undefined;
  }

  async play(source: PlaybackSource, positionMs = 0, startPaused = false): Promise<boolean> {
    if (!this.host) throw new Error('Player must be attached before playback');
    const playRequestGeneration = ++this.playRequestGeneration;
    this.wantsPlayback = !startPaused;
    this.activeSource = source;
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
    releaseDirectPlayReadAhead(this.directReadAheadSourceUrl);
    this.directReadAheadSourceUrl = undefined;
    this.hls?.destroy();
    this.hls = undefined;

    let video = this.video;
    if (video) {
      // Keep the media element itself across transformed seek generations.
      // Recreating it forces the browser to rebuild the entire playback DOM
      // and can also drop element-scoped state such as fullscreen/PiP.
      video.pause();
      video.removeAttribute('src');
      video.load();
      this.log.debug('media-element-reused');
    } else {
      video = document.createElement('video');
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
      this.attachMediaDiagnostics(video);

      const publish = () => this.publish(video!);
      video.addEventListener('timeupdate', publish);
      video.addEventListener('pause', publish);
      video.addEventListener('play', publish);
      video.addEventListener('playing', publish);
      video.addEventListener('waiting', publish);
      video.addEventListener('seeking', publish);
      video.addEventListener('seeked', publish);
      video.addEventListener('canplay', publish);
      video.addEventListener('ended', publish);
      const resumeWhenReady = () => {
        if (!this.wantsPlayback || !video!.paused) return;
        this.requestPlay(video!, 'media-ready');
      };
      // Source attachment and MSE setup are asynchronous. A play() request made
      // before the media element has a usable source may be rejected by Chromium;
      // readiness events retry the *same viewer intent* without making readiness
      // part of application control flow.
      video.addEventListener('loadedmetadata', resumeWhenReady);
      video.addEventListener('loadeddata', resumeWhenReady);
      video.addEventListener('canplay', resumeWhenReady);
      this.video = video;
      while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
      this.host.appendChild(video);
    }

    const publish = () => this.publish(video!);
    if (positionMs > 0) {
      const initialSeek = () => {
        if (playRequestGeneration !== this.playRequestGeneration || video !== this.video) return;
        this.log.info('initial-local-seek', { requestedPositionMs: positionMs, before: videoState(video) });
        video.currentTime = positionMs / 1000;
        publish();
      };
      video.addEventListener('loadedmetadata', initialSeek, { once: true });
      this.initialSeekCleanup = () => video.removeEventListener('loadedmetadata', initialSeek);
    }

    void this.applySubtitle(video, source.subtitleUrl).catch((error) => {
      this.log.warn('subtitle-initial-load-failed', { url: source.subtitleUrl, error: error instanceof Error ? error.message : String(error) });
    });

    if (isHls(source)) {
      if (shouldUseManagedHls(this.options.forceNativeHls, Hls.isSupported())) {
        this.log.info('hls-js-selected', { url: source.url });
        this.attachHls(video, source.url, positionMs);
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
        setDirectPlayReadAheadMode(this.directReadAheadSourceUrl, 'bootstrap');
      }
      this.log.info('direct-source-selected', {
        url: source.url,
        mimeType: source.mimeType,
        readAhead: directUrl !== source.url,
      });
      video.src = directUrl;
    }

    const playStarted = performance.now();
    if (startPaused) {
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
    const starts: number[] = [];
    let total = 0;
    for (const duration of manifest.segment_durations_ms) {
      starts.push(total);
      total += duration;
    }

    const segmentAt = (positionMs: number): number => {
      const bounded = Math.max(0, positionMs);
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high + 1) / 2);
        if (starts[middle] <= bounded) low = middle;
        else high = middle - 1;
      }
      return low;
    };

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
      for (let index = current - 1; index <= current + 1; index += 1) {
        if (index < 0 || index >= starts.length) continue;
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

    const video = this.video;
    const bufferedRanges: PlaybackTimeRange[] = [];
    if (video) {
      for (let index = 0; index < video.buffered.length; index += 1) {
        bufferedRanges.push({
          startMs: video.buffered.start(index) * 1000,
          endMs: video.buffered.end(index) * 1000,
        });
      }
    }
    return webLocalSeekCoverage(source, bufferedRanges);
  }

  seek(positionMs: number): void {
    if (!this.video) {
      this.log.warn('local-seek-without-media', { positionMs });
      return;
    }
    const targetSeconds = Math.max(0, positionMs / 1000);
    let bufferedHit = false;
    for (let index = 0; index < this.video.buffered.length; index += 1) {
      if (this.video.buffered.start(index) <= targetSeconds && this.video.buffered.end(index) >= targetSeconds) {
        bufferedHit = true;
        break;
      }
    }
    this.log.info('local-seek-request', { positionMs, bufferedHit, state: videoState(this.video) });
    setDirectPlayReadAheadMode(this.directReadAheadSourceUrl, 'seeking');
    this.video.currentTime = targetSeconds;
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
    this.wantsPlayback = false;
    this.activeSource = undefined;
    this.log.debug('stop', this.video ? videoState(this.video) : undefined);
    this.hls?.destroy();
    this.hls = undefined;
    this.initialSeekCleanup?.();
    this.initialSeekCleanup = undefined;
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

  private attachHls(video: HTMLVideoElement, url: string, positionMs: number): void {
    const hls = new Hls(webHlsBufferConfig(positionMs));
    this.hls = hls;
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
    hls.on(Hls.Events.FRAG_BUFFERED, (_event, data) => this.log.debug('hls-fragment-buffered', { data: hlsEventSummary(data), state: videoState(video) }));
    hls.on(Hls.Events.ERROR, (_event, data) => {
      const payload = { data: hlsEventSummary(data), state: videoState(video) };
      if (!data.fatal) {
        this.log.warn('hls-error-nonfatal', payload);
        return;
      }
      this.log.error('hls-error-fatal', payload);
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        this.log.warn('hls-recovery-network-start-load', payload);
        hls.startLoad(video.currentTime);
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        this.log.warn('hls-recovery-media', payload);
        hls.recoverMediaError();
      } else {
        this.log.error('hls-unrecoverable-destroy', payload);
        hls.destroy();
        if (this.hls === hls) this.hls = undefined;
      }
    });
    hls.loadSource(url);
    hls.attachMedia(video);
  }

  private attachMediaDiagnostics(video: HTMLVideoElement): void {
    const stateEvents = [
      'loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'play', 'pause',
      'waiting', 'stalled', 'suspend', 'seeking', 'seeked', 'ended', 'durationchange', 'ratechange', 'emptied',
      'abort', 'error',
    ] as const;
    for (const name of stateEvents) {
      video.addEventListener(name, () => {
        if (name === 'playing') setDirectPlayReadAheadMode(this.directReadAheadSourceUrl, 'playing');
        else if (name === 'seeking') setDirectPlayReadAheadMode(this.directReadAheadSourceUrl, 'seeking');
        else if (name === 'seeked') setDirectPlayReadAheadMode(this.directReadAheadSourceUrl, video.paused ? 'paused' : 'playing');
        else if (name === 'pause' || name === 'ended') setDirectPlayReadAheadMode(this.directReadAheadSourceUrl, 'paused');
        const state = videoState(video);
        const readAhead = directPlayReadAheadMetrics(this.directReadAheadSourceUrl);
        const detail = readAhead ? { ...state, directReadAhead: readAhead } : state;
        if (name === 'waiting' || name === 'stalled' || name === 'error' || name === 'abort') this.log.warn(`media-${name}`, detail);
        else this.log.debug(`media-${name}`, detail);
      });
    }
    video.addEventListener('progress', () => {
      const now = performance.now();
      if (now - this.lastProgressLogMs < 1_000) return;
      this.lastProgressLogMs = now;
      this.log.debug('media-progress', videoState(video));
    });
    video.addEventListener('timeupdate', () => {
      const now = performance.now();
      if (now - this.lastTimeLogMs < 2_000) return;
      this.lastTimeLogMs = now;
      this.log.debug('media-time', videoState(video));
    });
  }

  private publish(video: HTMLVideoElement): void {
    const duration = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
    const bufferedRangesMs: Array<{ startMs: number; endMs: number }> = [];
    let forwardBufferMs = 0;
    const currentMs = video.currentTime * 1000;
    for (let index = 0; index < video.buffered.length; index += 1) {
      const startMs = video.buffered.start(index) * 1000;
      const endMs = video.buffered.end(index) * 1000;
      bufferedRangesMs.push({ startMs, endMs });
      if (startMs <= currentMs + 250 && endMs >= currentMs) forwardBufferMs = Math.max(forwardBufferMs, endMs - currentMs);
    }
    const event = {
      positionMs: currentMs,
      durationMs: duration,
      paused: video.paused,
      ended: video.ended,
      seeking: video.seeking,
      buffering: !video.paused
        && !video.ended
        && (video.seeking || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA),
      bufferedRangesMs,
      forwardBufferMs,
    };
    this.listeners.forEach((listener) => listener(event));
  }
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
