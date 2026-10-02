import type { PlaybackCapabilities } from '@machafoundation/core';
import type { Platform, Player } from '@machafoundation/core';
import { WebPlatform } from './WebPlatform';

/** Android TV shell backed by WebView's HTML media pipeline. */
export class AndroidWebPlatform implements Platform {
  readonly name = 'android' as const;
  /**
   * No `forceNativeHls` here. Forcing the native path is for engines with no
   * usable MediaSource; an Android WebView is a modern Chromium whose own
   * capability probe advertises `hlsFmp4` on the strength of MediaSource, so
   * declining it would ask for a container through a path it refuses to take.
   *
   * hls.js also brings an error channel. `prepareAlternate` is reachable only
   * from `degrade()`, and `degrade()` only from the player's degradation
   * events, which the native path does not raise; without them there is no
   * warm standby and every recovery is a full cold start.
   */
  private readonly web = new WebPlatform();

  async capabilities(): Promise<PlaybackCapabilities> {
    return { ...await this.web.capabilities(), platform: 'android' };
  }

  createPlayer(): Player {
    return this.web.createPlayer();
  }
}
