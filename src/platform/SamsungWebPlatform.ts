import { createClientLogger } from '../diagnostics/ClientLog';
import type { PlaybackCapabilities } from '../types';
import type { Platform, Player } from './Platform';
import { WebPlatform } from './WebPlatform';
import { registerSamsungMediaKeys } from './SamsungMediaKeys';

/**
 * Samsung's 2017 Tizen browser is deliberately treated as an old Web target,
 * not as an AVPlay target. Keep the decoder contract narrower than the TV's
 * native capabilities because playback is through Chromium 47 HTMLMediaElement.
 */
export class SamsungWebPlatform implements Platform {
  readonly name = 'tizen' as const;
  private readonly web = new WebPlatform({
    directPlayReadAhead: false,
    legacyMediaElement: true,
    forceNativeHls: true,
  });
  private readonly log = createClientLogger('playback.capabilities.samsung');

  constructor() {
    if (typeof window !== 'undefined') registerSamsungMediaKeys(window);
  }

  initialVolume(): number {
    // TV volume is owned by the television/remote. Keep the HTML media
    // element itself at unity and do not inherit the Web client's persisted
    // per-client volume (including a stale muted value).
    return 1;
  }

  async capabilities(): Promise<PlaybackCapabilities> {
    const detected = await this.web.capabilities();
    const capabilities: PlaybackCapabilities = {
      ...detected,
      platform: 'tizen',
    };
    this.log.info('detected-html5-profile', {
      platform: capabilities.platform,
      containers: capabilities.containers.join(', '),
      videoCodecs: capabilities.videoCodecs.join(', '),
      audioCodecs: capabilities.audioCodecs.join(', '),
      hlsFmp4: capabilities.hls,
      decoderResolutionLimit: 'none',
      hdr: capabilities.hdr.length > 0 ? capabilities.hdr.join(', ') : 'not-advertised',
    });
    return capabilities;
  }

  createPlayer(): Player {
    return this.web.createPlayer();
  }

  exitApplication(): void {
    const tizen = (window as Window & {
      tizen?: {
        application?: {
          getCurrentApplication?: () => { exit?: () => void };
        };
      };
    }).tizen;
    tizen?.application?.getCurrentApplication?.().exit?.();
  }
}
