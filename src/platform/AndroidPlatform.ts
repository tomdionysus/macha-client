import type { Platform, Player } from '@machafoundation/core';
import type { PlaybackCapabilities } from '@machafoundation/core';

/** Bridge for the future Android TV shell: a Kotlin host injects capability discovery and Media3/ExoPlayer playback. */
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
