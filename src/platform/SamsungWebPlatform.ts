import { createClientLogger, type PlaybackPolicyOverrides } from '@machafoundation/core';
import type { PlaybackCapabilities } from '@machafoundation/core';
import type { Platform, Player } from '@machafoundation/core';
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
    // The native player, paired with the MPEG-TS preference below. Measured on
    // this set, per stream inside fMP4 segments:
    //
    //             native player          hls.js / MediaSource
    //   h264      plays                  —
    //   HEVC      black screen           —
    //   E-AC-3    0.2s every ~20s        stream rejected outright
    //   AAC       silent                 plays
    //
    // hls.js was tried and is worse: it fails both HLS titles outright, since
    // MediaSource rejects E-AC-3 here. The one arrangement that worked was
    // hls.js with E-AC-3 excluded, forcing an AAC transcode — functional, but
    // re-encoding audio and HEVC that need no re-encoding, on every title.
    //
    // None of those faults are the container's fault in general: they are
    // fMP4's. MPEG-TS is what this vintage of native HLS player was built for,
    // and the server emits it with both streams copied. So the native path
    // returns, and the segment preference below is what keeps it off fMP4.
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
    // Never hand this set a whole file, however playable its streams are.
    //
    // Not a statement about decoding — it decodes these titles fine — but
    // about buffering. Direct play leaves read-ahead entirely to the media
    // element, and the Service Worker byte-range proxy that does that job on
    // the web cannot exist here: a Tizen widget is served from `file://`, and
    // Service Workers require a secure http(s) origin, so registration is
    // refused. Nor can MediaSource stand in — Chromium 47 takes fMP4 and WebM,
    // not an arbitrary progressive MP4 or Matroska, which is the very reason
    // the proxy was built rather than an MSE pipeline. Both doors are shut, so
    // on this platform there is no way to read ahead of a file.
    //
    // Segments are the way out, and the way every television player already
    // works: the native HLS player buffers a playlist properly, which is what
    // it was built to do. Remux copies both streams into MPEG-TS carriage
    // (see `preferSegmentContainer` below), so the cost is a container
    // rewrite — no re-encode, no quality lost, no decoder asked anything new.
    //
    // Stated as policy rather than by narrowing `containers`, for the same
    // reason as `webm` below: the capability describes what the hardware
    // decodes, the policy describes what we will ask for.
    neverDirect: true,
    excludeContainers: ['webm'],
    // Segment as MPEG-TS, not fMP4. Every fault this set has shown on HLS is
    // an fMP4 fault — see the table on `forceNativeHls` above — and none of
    // the codecs involved are at fault anywhere else: the same HEVC direct
    // plays, the same E-AC-3 plays progressively, and h264 in fMP4 is fine.
    //
    // Deliberately no codec exclusions to accompany this. Excluding E-AC-3 was
    // tried twice tonight, once on each delivery path, and both times it moved
    // the failure rather than removing it — a policy stated at the codec level
    // against a fault at the container level narrows the choice into a worse
    // branch, which the chooser then faithfully defends. TS carries both
    // streams copied, so there is nothing left to exclude.
    preferSegmentContainer: 'mpegts',
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
