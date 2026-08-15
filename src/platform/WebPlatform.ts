import type { Platform, PlaybackListener, Player } from './Platform';
import type { PlaybackCapabilities, PlaybackSource } from '../types';

class WebPlayer implements Player {
  private host?: HTMLElement;
  private video?: HTMLVideoElement;
  private listeners = new Set<PlaybackListener>();

  attach(host: HTMLElement): void {
    this.host = host;
  }

  detach(): void {
    this.stop();
    this.host = undefined;
  }

  async play(source: PlaybackSource, positionMs = 0): Promise<void> {
    if (!this.host) throw new Error('Player must be attached before playback');
    this.stop();

    const video = document.createElement('video');
    video.className = 'native-video';
    video.autoplay = true;
    video.controls = false;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = source.url;

    const publish = () => this.publish(video);
    video.addEventListener('timeupdate', publish);
    video.addEventListener('pause', publish);
    video.addEventListener('play', publish);
    video.addEventListener('ended', publish);
    video.addEventListener('loadedmetadata', () => {
      if (positionMs > 0) video.currentTime = positionMs / 1000;
      publish();
    });

    this.video = video;
    this.host.replaceChildren(video);
    await video.play();
  }

  pause(): void {
    this.video?.pause();
  }

  resume(): void {
    void this.video?.play();
  }

  seek(positionMs: number): void {
    if (this.video) this.video.currentTime = Math.max(0, positionMs / 1000);
  }

  stop(): void {
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
    if (supportedMime('audio/ac3')) audioCodecs.push('ac3');
    if (supportedMime('audio/eac3')) audioCodecs.push('eac3');
    if (supportedMime('audio/mpeg')) audioCodecs.push('mp3');
    if (supportedMime('audio/flac')) audioCodecs.push('flac');

    return {
      platform: 'web',
      maxWidth: screenWidth,
      maxHeight: screenHeight,
      videoCodecs,
      audioCodecs,
      containers: ['mp4', 'webm'],
      hls: supportedMime('application/vnd.apple.mpegurl'),
      // This adapter intentionally does not contain a DASH manifest/MSE engine.
      dash: false,
      hdr: [],
    };
  }

  createPlayer(): Player {
    return new WebPlayer();
  }
}
