import type { PlaybackCapabilities, PlaybackEvent, PlaybackSource, PlaybackTimeRange } from '../types';

export type PlaybackListener = (event: PlaybackEvent) => void;
export type PlaybackFailureListener = (error: Error) => void;

export interface Player {
  /** Bind the existing player surface to a presentation host. Must not create a playback session. */
  attach(host: HTMLElement): void;
  /** Unbind presentation without changing playback/resource ownership. */
  detachHost?(): void;
  /** Final player destruction. This is resource-destructive. */
  detach(): void;
  /** Attach a source at a source-generation-local position and request playback. Resolves once dispatched, never when buffering completes. */
  play(source: PlaybackSource, positionMs?: number, startPaused?: boolean): Promise<boolean>;
  /** Pause transport and suspend avoidable/speculative source acquisition. */
  pause(): void;
  /** Resume source acquisition as necessary and continue the active generation. */
  resume(): void;
  seek(positionMs: number): void;
  /**
   * Source-generation-local timeline ranges that the active player can seek to
   * without changing the playback session or creating another source generation.
   * Implementations must normalize platform/media timestamp origins before
   * exposing these ranges; seek() uses this same coordinate system.
   */
  localSeekCoverage(): readonly PlaybackTimeRange[];
  setVolume(volume: number): void;
  /** Replace the subtitle resource without touching active A/V playback. */
  setSubtitle?(subtitleUrl?: string): Promise<void> | void;
  /** Release all source-side resources and cancel active acquisition. */
  stop(): void;
  subscribe(listener: PlaybackListener): () => void;
  /** Subscribe to terminal source/player failures that require generation teardown. */
  subscribeFailure?(listener: PlaybackFailureListener): () => void;
}

export interface Platform {
  readonly name: 'web' | 'android' | 'tizen';
  /** Native/system volume when the platform owns audio volume, otherwise undefined. */
  initialVolume?(): number | undefined;
  capabilities(): Promise<PlaybackCapabilities>;
  createPlayer(): Player;
  exitApplication?(): void;
}
