import type { Platform, Player } from './Platform';
import type { PlaybackCapabilities } from '../types';

/** Future Samsung TV adapter. The .wgt host will supply this bridge using AVPlay. */
export interface TizenBridge {
  capabilities(): Promise<PlaybackCapabilities>;
  createPlayer(): Player;
  exitApplication?(): void;
}

export class TizenPlatform implements Platform {
  readonly name = 'tizen' as const;

  constructor(private readonly bridge: TizenBridge) {}

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
