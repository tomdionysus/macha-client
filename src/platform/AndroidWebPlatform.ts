import type { PlaybackCapabilities } from '../types';
import type { Platform, Player } from './Platform';
import { WebPlatform } from './WebPlatform';

/** Android TV shell backed by WebView's native HTML media pipeline. */
export class AndroidWebPlatform implements Platform {
  readonly name = 'android' as const;
  private readonly web = new WebPlatform({ forceNativeHls: true });

  async capabilities(): Promise<PlaybackCapabilities> {
    return { ...await this.web.capabilities(), platform: 'android' };
  }

  createPlayer(): Player {
    return this.web.createPlayer();
  }
}
