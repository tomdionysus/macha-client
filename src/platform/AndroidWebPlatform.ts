import type { PlaybackCapabilities } from '@machafoundation/core';
import type { Platform, Player } from '@machafoundation/core';
import { WebPlatform } from './WebPlatform';

/** Android TV shell backed by WebView's HTML media pipeline. */
export class AndroidWebPlatform implements Platform {
  readonly name = 'android' as const;
  /**
   * No `forceNativeHls`: the WebView is a modern Chromium with MediaSource, and
   * only hls.js raises the degradation events that reach `prepareAlternate`.
   * Without them there is no warm standby and every recovery is a cold start.
   */
  private readonly web = new WebPlatform();

  async capabilities(): Promise<PlaybackCapabilities> {
    return { ...await this.web.capabilities(), platform: 'android' };
  }

  createPlayer(): Player {
    return this.web.createPlayer();
  }
}
