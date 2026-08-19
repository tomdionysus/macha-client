import { createClientLogger } from '../diagnostics/ClientLog';
import type { PlaybackCapabilities, PlaybackSource } from '../types';
import type { Platform, PlaybackListener, Player } from './Platform';

type AvPlayState = 'NONE' | 'IDLE' | 'READY' | 'PLAYING' | 'PAUSED';

interface AvPlayErrorLike {
  name?: string;
  message?: string;
  toString(): string;
}

interface SamsungAvPlayListener {
  onbufferingstart?(): void;
  onbufferingprogress?(percent: number): void;
  onbufferingcomplete?(): void;
  oncurrentplaytime?(currentTime: number): void;
  onstreamcompleted?(): void;
  onevent?(eventType: string, data: string): void;
  onerror?(eventType: string): void;
  onerrormsg?(eventType: string, message: string): void;
  onsubtitlechange?(duration: string, subtitles: string): void;
  ondrmevent?(type: string, data: unknown): void;
  onresourceconflicted?(): void;
}

interface SamsungAvPlayApi {
  open(url: string): void;
  close(): void;
  prepareAsync(success?: () => void, error?: (error: AvPlayErrorLike) => void): void;
  setDisplayRect(x: number, y: number, width: number, height: number): void;
  setDisplayMethod(mode: 'PLAYER_DISPLAY_MODE_LETTER_BOX' | 'PLAYER_DISPLAY_MODE_FULL_SCREEN' | 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO'): void;
  play(): void;
  pause(): void;
  stop(): void;
  seekTo(positionMs: number, success?: () => void, error?: (error: AvPlayErrorLike) => void): void;
  getState(): AvPlayState;
  getDuration(): number;
  getCurrentTime(): number;
  setListener(listener: SamsungAvPlayListener): void;
  setTimeoutForBuffering(seconds: number): void;
  setBufferingParam(
    option: 'PLAYER_BUFFER_FOR_PLAY' | 'PLAYER_BUFFER_FOR_RESUME',
    unit: 'PLAYER_BUFFER_SIZE_IN_SECOND',
    amount: number,
  ): void;
  setExternalSubtitlePath?(path: string): void;
}

declare global {
  interface Window {
    webapis?: {
      avplay?: SamsungAvPlayApi;
    };
  }
}

function avplay(): SamsungAvPlayApi {
  const api = window.webapis?.avplay;
  if (!api) throw new Error('Samsung AVPlay API is unavailable');
  return api;
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const value = error as AvPlayErrorLike;
    if (value.message) return value.message;
    if (value.name) return value.name;
  }
  return String(error);
}

class SamsungAvPlayer implements Player {
  private host?: HTMLElement;
  private object?: HTMLObjectElement;
  private listeners: PlaybackListener[] = [];
  private durationMs = 0;
  private positionMs = 0;
  private paused = true;
  private ended = false;
  private seekInFlight = false;
  private resumeAfterSeek = false;
  private readonly log = createClientLogger('playback.samsung-avplay');
  private readonly onResize = () => this.updateDisplayRect();

  attach(host: HTMLElement): void {
    this.host = host;
    let object = this.object;
    if (!object) {
      object = document.createElement('object');
      object.type = 'application/avplayer';
      object.className = 'native-video samsung-avplay';
      this.object = object;
    }
    while (host.firstChild) host.removeChild(host.firstChild);
    host.appendChild(object);
    window.addEventListener('resize', this.onResize);
    this.updateDisplayRect();
  }

  detach(): void {
    window.removeEventListener('resize', this.onResize);
    this.stop();
    if (this.object?.parentNode) this.object.parentNode.removeChild(this.object);
    this.host = undefined;
  }

  async play(source: PlaybackSource, positionMs = 0): Promise<boolean> {
    const api = avplay();
    this.resetNativePlayer(api);
    this.positionMs = Math.max(0, positionMs);
    this.durationMs = Math.max(0, source.durationMs ?? 0);
    this.paused = true;
    this.ended = false;
    this.seekInFlight = false;
    this.resumeAfterSeek = false;

    this.log.info('source-load-begin', {
      url: source.url,
      mode: source.mode,
      mimeType: source.mimeType,
      requestedPositionMs: positionMs,
    });

    api.open(source.url);
    api.setListener({
      onbufferingstart: () => this.log.debug('buffering-start'),
      onbufferingprogress: (percent) => this.log.debug('buffering-progress', { percent }),
      onbufferingcomplete: () => this.log.debug('buffering-complete'),
      oncurrentplaytime: (currentTime) => {
        this.positionMs = currentTime;
        this.durationMs = this.safeDuration(api, this.durationMs);
        this.paused = false;
        this.ended = false;
        this.publish();
      },
      onstreamcompleted: () => {
        this.positionMs = this.safeDuration(api, this.durationMs);
        this.durationMs = this.positionMs;
        this.paused = true;
        this.ended = true;
        this.publish();
      },
      onerror: (eventType) => this.log.error('avplay-error', { eventType }),
      onerrormsg: (eventType, message) => this.log.error('avplay-error-message', { eventType, message }),
      onevent: (eventType, data) => this.log.debug('avplay-event', { eventType, data }),
      onresourceconflicted: () => this.log.warn('avplay-resource-conflicted'),
    });

    this.updateDisplayRect();
    api.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');

    // AVPlay defaults to roughly ten seconds of initial playable data. Four
    // seconds is the documented minimum and is a better fit for local Macha VOD.
    try {
      api.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 4);
      api.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', 4);
      api.setTimeoutForBuffering(6);
    } catch (error) {
      this.log.warn('buffer-tuning-unsupported', { error: errorText(error) });
    }

    // Samsung AVPlay accepts a concrete external subtitle file while IDLE,
    // not Macha's segmented subtitle manifest. Dynamic segmented subtitle
    // switching is therefore left unsupported here rather than restarting the
    // active A/V session behind the user.
    if (source.subtitleUrl && /\.vtt(?:$|[?#])/i.test(source.subtitleUrl) && api.setExternalSubtitlePath) {
      try {
        api.setExternalSubtitlePath(source.subtitleUrl);
      } catch (error) {
        this.log.warn('external-subtitle-failed', { url: source.subtitleUrl, error: errorText(error) });
      }
    }

    const startedAt = performance.now();
    await new Promise<void>((resolve, reject) => {
      api.prepareAsync(resolve, (error) => reject(new Error(`AVPlay prepare failed: ${errorText(error)}`)));
    });

    this.durationMs = this.safeDuration(api, this.durationMs);
    if (this.positionMs > 0) {
      await this.seekAsync(api, this.positionMs);
    }

    api.play();
    this.paused = false;
    this.ended = false;
    this.publish();
    this.log.info('playback-started', {
      elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
      durationMs: this.durationMs,
      positionMs: this.positionMs,
    });
    return true;
  }

  pause(): void {
    const api = avplay();
    const state = this.safeState(api);
    if (state !== 'PLAYING') return;
    api.pause();
    this.positionMs = this.safeCurrentTime(api, this.positionMs);
    this.paused = true;
    this.publish();
  }

  resume(): void {
    if (this.seekInFlight) {
      this.resumeAfterSeek = true;
      return;
    }
    const api = avplay();
    const state = this.safeState(api);
    if (state !== 'READY' && state !== 'PAUSED') return;
    api.play();
    this.paused = false;
    this.ended = false;
    this.publish();
  }

  seek(positionMs: number): void {
    const api = avplay();
    const bounded = Math.max(0, Math.min(this.safeDuration(api, this.durationMs) || positionMs, positionMs));
    const shouldResume = !this.paused || this.resumeAfterSeek;
    this.seekInFlight = true;
    this.resumeAfterSeek = shouldResume;
    api.seekTo(
      bounded,
      () => {
        this.seekInFlight = false;
        this.positionMs = bounded;
        this.paused = true;
        this.ended = false;
        this.publish();
        if (this.resumeAfterSeek) {
          this.resumeAfterSeek = false;
          this.resume();
        }
      },
      (error) => {
        this.seekInFlight = false;
        this.resumeAfterSeek = false;
        this.log.error('seek-failed', { positionMs: bounded, error: errorText(error) });
      },
    );
  }

  stop(): void {
    const api = window.webapis?.avplay;
    if (api) this.resetNativePlayer(api);
    this.durationMs = 0;
    this.positionMs = 0;
    this.paused = true;
    this.ended = false;
    this.seekInFlight = false;
    this.resumeAfterSeek = false;
  }

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  private publish(): void {
    const event = {
      positionMs: this.positionMs,
      durationMs: this.durationMs,
      paused: this.paused,
      ended: this.ended,
    };
    for (let index = 0; index < this.listeners.length; index += 1) {
      this.listeners[index]?.(event);
    }
  }

  private resetNativePlayer(api: SamsungAvPlayApi): void {
    try {
      const state = api.getState();
      if (state === 'PLAYING' || state === 'PAUSED' || state === 'READY') api.stop();
    } catch {
      // A half-open AVPlay instance can throw while being torn down; close is
      // still safe to attempt and resets the singleton for the next source.
    }
    try {
      api.close();
    } catch {
      // NONE is already the desired state.
    }
  }

  private safeState(api: SamsungAvPlayApi): AvPlayState {
    try {
      return api.getState();
    } catch {
      return 'NONE';
    }
  }

  private safeDuration(api: SamsungAvPlayApi, fallback: number): number {
    try {
      return api.getDuration() || fallback;
    } catch {
      return fallback;
    }
  }

  private safeCurrentTime(api: SamsungAvPlayApi, fallback: number): number {
    try {
      return api.getCurrentTime();
    } catch {
      return fallback;
    }
  }

  private seekAsync(api: SamsungAvPlayApi, positionMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      api.seekTo(positionMs, resolve, (error) => reject(new Error(`AVPlay seek failed: ${errorText(error)}`)));
    });
  }

  private updateDisplayRect(): void {
    const api = window.webapis?.avplay;
    const host = this.host;
    if (!api || !host) return;
    const rect = host.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 1920;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight || 1080;
    const xScale = 1920 / viewportWidth;
    const yScale = 1080 / viewportHeight;
    try {
      api.setDisplayRect(
        Math.max(0, Math.round(rect.left * xScale)),
        Math.max(0, Math.round(rect.top * yScale)),
        Math.max(1, Math.round(rect.width * xScale)),
        Math.max(1, Math.round(rect.height * yScale)),
      );
    } catch (error) {
      this.log.warn('display-rect-failed', { error: errorText(error) });
    }
  }
}

export class SamsungTizenPlatform implements Platform {
  readonly name = 'tizen' as const;

  async capabilities(): Promise<PlaybackCapabilities> {
    // Conservative 2017/Tizen 3 baseline. These are native TV decoder
    // capabilities rather than Chromium M47 HTMLMediaElement capabilities.
    return {
      platform: 'tizen',
      maxWidth: 3840,
      maxHeight: 2160,
      videoCodecs: ['h264', 'hevc', 'vp9', 'mpeg2'],
      audioCodecs: ['aac', 'ac3', 'eac3', 'mp3'],
      containers: ['mp4', 'webm', 'matroska'],
      hls: true,
      dash: true,
      hdr: [],
    };
  }

  createPlayer(): Player {
    avplay();
    return new SamsungAvPlayer();
  }
}
