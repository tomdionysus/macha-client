import type { PlaybackCapabilities, PlaybackEvent, PlaybackSource } from '../types';

export type PlaybackListener = (event: PlaybackEvent) => void;

export interface Player {
  attach(host: HTMLElement): void;
  detach(): void;
  /** Start a source and report whether playback actually began (autoplay may be blocked). */
  play(source: PlaybackSource, positionMs?: number): Promise<boolean>;
  pause(): void;
  resume(): void;
  seek(positionMs: number): void;
  /** Replace the subtitle resource without touching active A/V playback. */
  setSubtitle?(subtitleUrl?: string): Promise<void> | void;
  stop(): void;
  subscribe(listener: PlaybackListener): () => void;
}

export interface Platform {
  readonly name: 'web' | 'android' | 'tizen';
  capabilities(): Promise<PlaybackCapabilities>;
  createPlayer(): Player;
  exitApplication?(): void;
}
