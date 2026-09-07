import type { Platform, Player } from '@macha/core';
import type { PlaybackCapabilities } from '@macha/core';

/**
 * Wiring contract for the future Android TV shell.
 *
 * The React bundle remains unchanged. A tiny Kotlin host will inject a bridge
 * implementing capability discovery and Media3/ExoPlayer playback. Keeping the
 * bridge behind Platform prevents Android-specific code leaking into the UI.
 */
export interface AndroidBridge {
  capabilities(): Promise<PlaybackCapabilities>;
  createPlayer(): Player;
  exitApplication?(): void;
}

export class AndroidPlatform implements Platform {
  readonly name = 'android' as const;

  constructor(private readonly bridge: AndroidBridge) {}

  capabilities(): Promise<PlaybackCapabilities> {
    return this.bridge.capabilities();
  }

  createPlayer(): Player {
    return this.bridge.createPlayer();
  }

  exitApplication(): void {
    this.bridge.exitApplication?.();
  }
}
