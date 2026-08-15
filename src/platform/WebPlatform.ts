import Hls from 'hls.js';
import { createClientLogger } from '../diagnostics/ClientLog';
import type { Platform, PlaybackListener, Player } from './Platform';
import type { PlaybackCapabilities, PlaybackSource } from '../types';

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
    this.stop();

    const video = document.createElement('video');
    video.className = 'native-video';
    video.autoplay = true;
    video.controls = false;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    this.attachMediaDiagnostics(video);

    const publish = () => this.publish(video);
    video.addEventListener('timeupdate', publish);
    video.addEventListener('pause', publish);
    video.addEventListener('play', publish);
    video.addEventListener('ended', publish);
    video.addEventListener('loadedmetadata', () => {
      if (positionMs > 0) {
        this.log.info('initial-local-seek', { requestedPositionMs: positionMs, before: videoState(video) });
        video.currentTime = positionMs / 1000;
      }
      publish();
    });

    if (source.subtitleUrl) {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = 'Selected subtitles';
      track.src = source.subtitleUrl;
      track.default = true;
      track.addEventListener('load', () => {
        track.track.mode = 'showing';
        this.log.debug('subtitle-loaded', { url: source.subtitleUrl });
      });
      track.addEventListener('error', () => this.log.warn('subtitle-error', { url: source.subtitleUrl }));
      video.append(track);
    }

    this.video = video;
    this.host.replaceChildren(video);

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
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
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

function supportedMime(mime: string): boolean {
  const video = document.createElement('video');
  return video.canPlayType(mime) !== '';
}

export class WebPlatform implements Platform {
  readonly name = 'web' as const;
  private readonly log = createClientLogger('playback.capabilities');

  async capabilities(): Promise<PlaybackCapabilities> {
    const pixelRatio = window.devicePixelRatio || 1;
    const screenWidth = Math.round((window.screen?.width || 1920) * pixelRatio);
    const screenHeight = Math.round((window.screen?.height || 1080) * pixelRatio);

    const videoCodecs: string[] = [];
    if (supportedMime('video/mp4; codecs="avc1.42E01E"')) videoCodecs.push('h264');
    if (supportedMime('video/mp4; codecs="hev1.1.6.L93.B0"') || supportedMime('video/mp4; codecs="hvc1.1.6.L93.B0"')) videoCodecs.push('hevc');
    if (supportedMime('video/webm; codecs="vp9"')) videoCodecs.push('vp9');
    if (supportedMime('video/mp4; codecs="av01.0.05M.08"')) videoCodecs.push('av1');

    const audioCodecs: string[] = [];
    if (supportedMime('video/mp4; codecs="mp4a.40.2"')) audioCodecs.push('aac');
    if (supportedMime('video/webm; codecs="opus"')) audioCodecs.push('opus');
    if (supportedMime('audio/ogg; codecs="vorbis"')) audioCodecs.push('vorbis');
    if (supportedMime('audio/ac3')) audioCodecs.push('ac3');
    if (supportedMime('audio/eac3')) audioCodecs.push('eac3');
    if (supportedMime('audio/mpeg')) audioCodecs.push('mp3');
    if (supportedMime('audio/flac')) audioCodecs.push('flac');

    const containers: string[] = [];
    if (supportedMime('video/mp4') || supportedMime('audio/mp4')) containers.push('mp4');
    if (supportedMime('video/webm') || supportedMime('audio/webm')) containers.push('webm');
    if (supportedMime('audio/mpeg')) containers.push('mp3');
    if (supportedMime('audio/flac')) containers.push('flac');
    if (supportedMime('audio/ogg')) containers.push('ogg');

    const video = document.createElement('video');
    const capabilities: PlaybackCapabilities = {
      platform: 'web',
      maxWidth: screenWidth,
      maxHeight: screenHeight,
      videoCodecs,
      audioCodecs,
      containers,
      hls: nativeHlsSupported(video) || Hls.isSupported(),
      dash: false,
      hdr: [],
    };
    this.log.info('detected', capabilities);
    return capabilities;
  }

  createPlayer(): Player {
    return new WebPlayer();
  }
}
