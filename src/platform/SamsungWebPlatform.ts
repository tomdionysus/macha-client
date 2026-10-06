import { createClientLogger, type PlaybackPolicyOverrides } from '@machafoundation/core';
import type { PlaybackCapabilities } from '@machafoundation/core';
import type { Platform, Player } from '@machafoundation/core';
import { WebPlatform } from './WebPlatform';
import { samsungDisplayResolution } from './displayResolution';
import { registerSamsungMediaKeys } from './SamsungMediaKeys';

/**
 * Samsung's 2017 Tizen browser as an old Web target, not AVPlay. Playback is
 * through Chromium 47's HTMLMediaElement, so the decoder contract is narrower
 * than the TV's native capabilities.
 */
export class SamsungWebPlatform implements Platform {
  readonly name = 'tizen' as const;
  private readonly web = new WebPlatform({
    directPlayReadAhead: false,
    legacyMediaElement: true,
    // Native player, paired with the MPEG-TS preference below. In fMP4 HLS, per stream:
    //
    //             native player          hls.js / MediaSource
    //   h264      plays                  -
    //   HEVC      black screen           -
    //   E-AC-3    0.2s every ~20s        stream rejected outright
    //   AAC       silent                 plays
    //
    // Every fault is fMP4's; MPEG-TS with both streams copied plays natively.
    forceNativeHls: true,
  });
  private readonly log = createClientLogger('playback.capabilities.samsung');

  /**
   * What to ask for, kept apart from `capabilities`, which state what the
   * hardware decodes. Never narrow the capabilities to enforce a policy.
   */
  readonly playbackPolicy: PlaybackPolicyOverrides = {
    // Direct play leaves read-ahead to the media element, and nothing can
    // buffer for it here: a widget on `file://` cannot register the Service
    // Worker range proxy, and Chromium 47 MSE takes only fMP4 and WebM. Remux
    // to segments is a container rewrite with no re-encode.
    neverDirect: true,
    // ffmpeg names every Matroska file `matroska,webm`; this set decodes WebM but renders Matroska corrupt.
    excludeContainers: ['webm'],
    // MPEG-TS, not fMP4: every HLS fault on this set is fMP4's (see
    // `forceNativeHls`). No codec exclusions: they move the failure to a worse
    // branch, and TS carries both streams copied.
    preferSegmentContainer: 'mpegts',
  };

  constructor() {
    if (typeof window !== 'undefined') registerSamsungMediaKeys(window);
  }

  initialVolume(): number {
    // The television owns volume: keep the element at unity and ignore the Web client's persisted volume.
    return 1;
  }

  /** The panel, not the 1920x1080 application surface; see `samsungDisplayResolution`. */
  readonly displayResolution = samsungDisplayResolution;

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
      hlsFmp4: capabilities.hlsFmp4,
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
