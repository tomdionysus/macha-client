import Hls from 'hls.js';
import { createClientLogger } from '../diagnostics/ClientLog';
import type { Platform, PlaybackListener, Player } from './Platform';
import type { PlaybackCapabilities, PlaybackSource } from '../types';
import { detectWebMediaCodecCapabilities } from './WebMediaCapabilities';

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

class WebPlayer implements Player {
  private host?: HTMLElement;
  private video?: HTMLVideoElement;
  private hls?: Hls;
  private listeners = new Set<PlaybackListener>();
  private readonly playerId = ++webPlayerSequence;
  private readonly log = createClientLogger('playback.web', { playerId: this.playerId });
  private lastTimeLogMs = 0;
  private lastProgressLogMs = 0;
  private pendingInitialPositionMs = 0;
  private subtitleGeneration = 0;
  private subtitleCleanup?: () => void;
  private subtitleTextTrack?: TextTrack;

  attach(host: HTMLElement): void {
    this.host = host;
    this.log.debug('attach');
  }

  detach(): void {
    this.log.debug('detach');
    this.stop();
    this.host = undefined;
  }

  async play(source: PlaybackSource, positionMs = 0): Promise<boolean> {
    if (!this.host) throw new Error('Player must be attached before playback');
    this.log.info('source-load-begin', {
      mode: source.mode,
      mimeType: source.mimeType,
      mediaId: source.mediaId,
      url: source.url,
      subtitleUrl: source.subtitleUrl,
      requestedPositionMs: positionMs,
      hls: isHls(source),
    });
    this.pendingInitialPositionMs = positionMs;
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
      this.attachMediaDiagnostics(video);

      const publish = () => this.publish(video!);
      video.addEventListener('timeupdate', publish);
      video.addEventListener('pause', publish);
      video.addEventListener('play', publish);
      video.addEventListener('ended', publish);
      video.addEventListener('loadedmetadata', () => {
        const requestedPositionMs = this.pendingInitialPositionMs;
        if (requestedPositionMs > 0) {
          this.log.info('initial-local-seek', { requestedPositionMs, before: videoState(video!) });
          video!.currentTime = requestedPositionMs / 1000;
        }
        publish();
      });
      this.video = video;
      while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
      this.host.appendChild(video);
    }

    const publish = () => this.publish(video!);

    void this.applySubtitle(video, source.subtitleUrl).catch((error) => {
      this.log.warn('subtitle-initial-load-failed', { url: source.subtitleUrl, error: error instanceof Error ? error.message : String(error) });
    });

    if (isHls(source)) {
      if (nativeHlsSupported(video)) {
        this.log.info('hls-native-selected', { url: source.url });
        video.src = source.url;
      } else if (Hls.isSupported()) {
        this.log.info('hls-js-selected', { url: source.url });
        await this.attachHls(video, source.url);
      } else {
        this.log.error('hls-unsupported', { url: source.url });
        throw new Error('This browser cannot play fragmented-MP4 HLS.');
      }
    } else {
      this.log.info('direct-source-selected', { url: source.url, mimeType: source.mimeType });
      video.src = source.url;
    }

    const playStarted = performance.now();
    try {
      await video.play();
      this.log.info('autoplay-started', {
        elapsedMs: Math.round((performance.now() - playStarted) * 10) / 10,
        state: videoState(video),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        this.log.warn('autoplay-blocked', {
          elapsedMs: Math.round((performance.now() - playStarted) * 10) / 10,
          error,
          state: videoState(video),
        });
        publish();
        return false;
      }
      this.log.error('autoplay-failed', { error, state: videoState(video) });
      throw error;
    }
    return !video.paused;
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
    this.log.info('pause-request', this.video ? videoState(this.video) : undefined);
    this.video?.pause();
  }

  resume(): void {
    const video = this.video;
    if (!video) {
      this.log.warn('resume-request-without-media');
      return;
    }
    this.log.info('resume-request', videoState(video));
    void video.play()
      .then(() => this.log.info('resume-started', videoState(video)))
      .catch((error) => this.log.error('resume-failed', { error, state: videoState(video) }));
  }

  seek(positionMs: number): void {
    if (!this.video) {
      this.log.warn('local-seek-without-media', { positionMs });
      return;
    }
    this.log.info('local-seek-request', { positionMs, state: videoState(this.video) });
    this.video.currentTime = Math.max(0, positionMs / 1000);
  }

  stop(): void {
    this.log.debug('stop', this.video ? videoState(this.video) : undefined);
    this.hls?.destroy();
    this.hls = undefined;
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

  private attachHls(video: HTMLVideoElement, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const hls = new Hls({ enableWorker: true });
      this.hls = hls;
      let settled = false;
      const attachedAt = performance.now();

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        this.log.error('hls-startup-failed', { message, elapsedMs: Math.round((performance.now() - attachedAt) * 10) / 10 });
        hls.destroy();
        if (this.hls === hls) this.hls = undefined;
        reject(new Error(message));
      };

      hls.on(Hls.Events.MEDIA_ATTACHED, () => this.log.debug('hls-media-attached'));
      hls.on(Hls.Events.MANIFEST_LOADING, (_event, data) => this.log.debug('hls-manifest-loading', hlsEventSummary(data)));
      hls.on(Hls.Events.MANIFEST_LOADED, (_event, data) => this.log.debug('hls-manifest-loaded', hlsEventSummary(data)));
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        this.log.info('hls-manifest-parsed', {
          elapsedMs: Math.round((performance.now() - attachedAt) * 10) / 10,
          data: hlsEventSummary(data),
        });
        if (settled) return;
        settled = true;
        resolve();
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
        if (!settled) {
          fail(`HLS startup error: ${data.details}`);
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          this.log.warn('hls-recovery-network-start-load', payload);
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          this.log.warn('hls-recovery-media', payload);
          hls.recoverMediaError();
        } else {
          this.log.error('hls-unrecoverable-destroy', payload);
          hls.destroy();
        }
      });
      this.log.debug('hls-load-source', { url });
      hls.loadSource(url);
      hls.attachMedia(video);
    });
  }

  private attachMediaDiagnostics(video: HTMLVideoElement): void {
    const stateEvents = [
      'loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'play', 'pause',
      'waiting', 'stalled', 'suspend', 'seeking', 'seeked', 'ended', 'durationchange', 'ratechange', 'emptied',
      'abort', 'error',
    ] as const;
    for (const name of stateEvents) {
      video.addEventListener(name, () => {
        const state = videoState(video);
        if (name === 'waiting' || name === 'stalled' || name === 'error' || name === 'abort') this.log.warn(`media-${name}`, state);
        else this.log.debug(`media-${name}`, state);
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
    const event = {
      positionMs: video.currentTime * 1000,
      durationMs: duration,
      paused: video.paused,
      ended: video.ended,
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
    return new WebPlayer();
  }
}
