import { createClientLogger, type PlaybackPolicyOverrides } from '@macha/core';
import type { PlaybackCapabilities } from '@macha/core';
import type { Platform, Player } from '@macha/core';
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
    // The native player stays. hls.js was tried to work around silent audio
    // on transcoded streams and did fix it, but it moved every non-direct
    // stream onto MediaSource, which on this set reports HEVC as supported
    // and then fails to decode it. The native path handles what it is
    // correctly given; the faults seen on it came from being handed streams
    // the client had not asked for.
    forceNativeHls: true,
  });
  private readonly log = createClientLogger('playback.capabilities.samsung');

  /**
   * Platform truths a probe cannot establish, stated as policy rather than
   * folded into the capability list.
   *
   * `webm`: ffmpeg reports every Matroska file as `matroska,webm` — its
   * demuxer family, not the file's identity. This set decodes WebM and says
   * so honestly, and that honest claim is what let a matcher testing "is any
   * of these names listed" hand it a Matroska file, which it renders corrupt.
   * The real fix is resolving that string to a container family before
   * matching, and the chooser now does. This is belt and braces for anywhere
   * else the string is read: the library contains no WebM at all, so refusing
   * to instruct it costs nothing and removes the ambiguity entirely.
   *
   * Deliberately a policy and not a narrowed `containers` list: the
   * capability describes what the hardware decodes, the policy describes what
   * we will ask for. Falsifying the first to achieve the second is how a
   * workaround outlives its reason.
   */
  readonly playbackPolicy: PlaybackPolicyOverrides = {
    excludeContainers: ['webm'],
    // Deliberately no audio codec exclusion here, though E-AC-3 through this
    // set's fMP4 path gives about half a second of sound every ten to twenty
    // seconds and it is tempting. Excluding it forces the AAC transcode, and
    // AAC through the same path produces no sound at all — so the exclusion
    // traded broken audio for silent audio.
    //
    // The codec was never the problem. HEVC copied into fMP4 black-screens,
    // E-AC-3 copied into fMP4 stutters, AAC transcoded into fMP4 is silent:
    // every stream this set is handed as fMP4 fails in its own way. It is a
    // carriage fault, and the fix is MPEG-TS segments, not a list of codecs
    // to avoid one at a time — see TODO/ACTIVE.md.
  };

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
