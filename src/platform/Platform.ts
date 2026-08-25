import type { PlaybackCapabilities, PlaybackEvent, PlaybackSource, PlaybackTimeRange } from '../types';

export type PlaybackListener = (event: PlaybackEvent) => void;

export interface Player {
  attach(host: HTMLElement): void;
  detach(): void;
  /** Attach a source and request playback. Resolves once the request is dispatched, never when buffering completes. */
  play(source: PlaybackSource, positionMs?: number, startPaused?: boolean): Promise<boolean>;
  pause(): void;
  resume(): void;
  seek(positionMs: number): void;
  /**
   * Source-local timeline ranges that the active player can seek to without
   * changing the playback session or creating another source generation.
   */
  localSeekCoverage(): readonly PlaybackTimeRange[];
  setVolume(volume: number): void;
  /** Replace the subtitle resource without touching active A/V playback. */
  setSubtitle?(subtitleUrl?: string): Promise<void> | void;
  stop(): void;
  subscribe(listener: PlaybackListener): () => void;
}

export interface Platform {
  readonly name: 'web' | 'android' | 'tizen';
  /** Native/system volume when the platform owns audio volume, otherwise undefined. */
  initialVolume?(): number | undefined;
  capabilities(): Promise<PlaybackCapabilities>;
  createPlayer(): Player;
  exitApplication?(): void;
}
