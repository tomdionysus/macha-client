import type { PlaybackCapabilities, PlaybackEvent, PlaybackSource } from '../types';

export type PlaybackListener = (event: PlaybackEvent) => void;

export interface Player {
  attach(host: HTMLElement): void;
  detach(): void;
  play(source: PlaybackSource, positionMs?: number): Promise<void>;
  pause(): void;
  resume(): void;
  seek(positionMs: number): void;
  stop(): void;
  subscribe(listener: PlaybackListener): () => void;
}

export interface Platform {
  readonly name: 'web' | 'android' | 'tizen';
  capabilities(): Promise<PlaybackCapabilities>;
  createPlayer(): Player;
  exitApplication?(): void;
}
