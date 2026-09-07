import { describe, expect, it } from 'vitest';
import { detectHlsTsSupport, detectWebMediaCodecCapabilities, hlsDeliveryProbe } from './WebMediaCapabilities';

function probeFrom(supported: readonly string[]): (mime: string) => boolean {
  const set = new Set(supported);
  return (mime) => set.has(mime);
}

describe('detectWebMediaCodecCapabilities', () => {
  it('recognises AC-3 and E-AC-3 through their fMP4 codec identifiers', () => {
    const capabilities = detectWebMediaCodecCapabilities(probeFrom([
      'video/mp4',
      'audio/mp4; codecs="ac-3"',
      'audio/mp4; codecs="ec-3"',
    ]));

    expect(capabilities.containers).toContain('mp4');
    expect(capabilities.audioCodecs).toContain('ac3');
    expect(capabilities.audioCodecs).toContain('eac3');
  });

  it('retains legacy raw Dolby MIME probes as compatibility fallbacks', () => {
    const capabilities = detectWebMediaCodecCapabilities(probeFrom([
      'audio/x-ac3',
      'audio/x-eac3',
    ]));

    expect(capabilities.audioCodecs).toEqual(['ac3', 'eac3']);
  });

  it('does not advertise Dolby codecs when no browser probe accepts them', () => {
    const capabilities = detectWebMediaCodecCapabilities(probeFrom([
      'video/mp4',
      'video/mp4; codecs="avc1.42E01E"',
      'audio/mp4; codecs="mp4a.40.2"',
    ]));

    expect(capabilities.videoCodecs).toEqual(['h264']);
    expect(capabilities.audioCodecs).toEqual(['aac']);
  });

  describe('colour depth and dynamic range', () => {
    const highDynamicRange = (query: string) => query === '(video-dynamic-range: high)';

    it('reports 8-bit and no HDR for a plain SDR pipeline', () => {
      const capabilities = detectWebMediaCodecCapabilities(probeFrom(['video/mp4; codecs="avc1.42E01E"']), highDynamicRange);
      expect(capabilities.videoBitDepth).toBe(8);
      expect(capabilities.hdrTransfers).toEqual([]);
    });

    it('reports 10-bit from a Main 10 probe, and 12-bit where it goes deeper', () => {
      expect(detectWebMediaCodecCapabilities(probeFrom(['video/mp4; codecs="hev1.2.4.L120.B0"'])).videoBitDepth).toBe(10);
      expect(detectWebMediaCodecCapabilities(probeFrom(['video/webm; codecs="vp09.02.10.10"'])).videoBitDepth).toBe(10);
      expect(detectWebMediaCodecCapabilities(probeFrom(['video/mp4; codecs="av01.0.05M.12"'])).videoBitDepth).toBe(12);
    });

    it('claims HDR only when a deep decoder AND a presentation path both exist', () => {
      const deep = probeFrom(['video/mp4; codecs="hev1.2.4.L120.B0"']);
      // Decoder but no display claim: a TV that shows PQ as washed-out SDR.
      expect(detectWebMediaCodecCapabilities(deep).hdrTransfers).toEqual([]);
      expect(detectWebMediaCodecCapabilities(deep, () => false).hdrTransfers).toEqual([]);
      expect(detectWebMediaCodecCapabilities(deep, highDynamicRange).hdrTransfers).toEqual(['smpte2084', 'arib-std-b67']);
    });

    it('does not claim HDR on a display that reports it without a deep decoder', () => {
      const shallow = probeFrom(['video/mp4; codecs="avc1.42E01E"']);
      expect(detectWebMediaCodecCapabilities(shallow, highDynamicRange).hdrTransfers).toEqual([]);
    });

    it('makes no claim at all on an engine with no media-query support', () => {
      // Tizen 3 has no matchMedia; the safe answer is "not HDR", which sends
      // a 10-bit source down the transcode path rather than showing nothing.
      const capabilities = detectWebMediaCodecCapabilities(probeFrom(['video/mp4; codecs="hev1.2.4.L120.B0"']), undefined);
      expect(capabilities.hdrTransfers).toEqual([]);
    });
  });

  describe('Dolby Vision profiles', () => {
    const highDynamicRange = (query: string) => query === '(video-dynamic-range: high)';
    const deep = 'video/mp4; codecs="hev1.2.4.L120.B0"';

    it('claims nothing when no DV codec probes true', () => {
      expect(detectWebMediaCodecCapabilities(probeFrom([deep]), highDynamicRange).dolbyVision).toEqual([]);
    });

    it('ignores a DV codec answer from an engine with no HDR presentation path', () => {
      // A DV fourCC embeds an HEVC profile, so an engine can answer true about
      // the base layer alone. Without a display path that is a false positive,
      // and believing it is a black screen rather than a needless transcode.
      const claimsDv = probeFrom([deep, 'video/mp4; codecs="dvhe.05.06"']);
      expect(detectWebMediaCodecCapabilities(claimsDv).dolbyVision).toEqual([]);
      expect(detectWebMediaCodecCapabilities(claimsDv, () => false).dolbyVision).toEqual([]);
      expect(detectWebMediaCodecCapabilities(claimsDv, highDynamicRange).dolbyVision).toEqual([5]);
    });

    it('reports only the profiles that actually probe, not a blanket yes', () => {
      // A set handling profile 8 but not 5 is the common case, and the whole
      // reason this is a list: a boolean would force it to lie either way.
      const capabilities = detectWebMediaCodecCapabilities(probeFrom([deep, 'video/mp4; codecs="dvhe.08.09"']), highDynamicRange);
      expect(capabilities.dolbyVision).toEqual([8]);
    });

    it('accepts either fourCC, since engines disagree on which they advertise', () => {
      expect(detectWebMediaCodecCapabilities(probeFrom([deep, 'video/mp4; codecs="dvh1.05.06"']), highDynamicRange).dolbyVision).toEqual([5]);
      expect(detectWebMediaCodecCapabilities(probeFrom([deep, 'video/mp4; codecs="dvhe.05.06"']), highDynamicRange).dolbyVision).toEqual([5]);
    });

    it('reports several profiles in ascending order', () => {
      const capabilities = detectWebMediaCodecCapabilities(probeFrom([
        deep,
        'video/mp4; codecs="dvhe.08.09"',
        'video/mp4; codecs="dvh1.05.06"',
      ]), highDynamicRange);
      expect(capabilities.dolbyVision).toEqual([5, 8]);
    });
  });

  describe('when MediaSource is the decoder', () => {
    // The Last of Us S02E07: HEVC Main 10, bt709. The TV decodes it natively
    // and refuses it through MSE, so once hls.js drove playback the element's
    // answer produced "Web media decode failure" on a stream the server had
    // every reason to believe was playable.
    const element = probeFrom([
      'video/mp4; codecs="avc1.42E01E"',
      'video/mp4; codecs="hev1.1.6.L93.B0"',
      'video/mp4; codecs="hev1.2.4.L120.B0"',
    ]);
    const mseWithoutHevc = probeFrom(['video/mp4; codecs="avc1.42E01E"']);

    it('claims what the element decodes when nothing else will decode it', () => {
      const capabilities = detectWebMediaCodecCapabilities(element);
      expect(capabilities.videoCodecs).toContain('hevc');
      expect(capabilities.videoBitDepth).toBe(10);
    });

    it('keeps a codec the element decodes while narrowing the HLS subset', () => {
      // Direct play uses the media element, so `videoCodecs` must keep hevc or
      // a perfectly playable file gets transcoded for nothing. Only streams
      // delivered through MediaSource are narrowed.
      const capabilities = detectWebMediaCodecCapabilities(element, undefined, mseWithoutHevc);
      expect(capabilities.videoCodecs).toEqual(['h264', 'hevc']);
      expect(capabilities.hlsVideoCodecs).toEqual(['h264']);
    });

    it('leaves the two lists equal when both decoders agree', () => {
      const capabilities = detectWebMediaCodecCapabilities(element, undefined, element);
      expect(capabilities.hlsVideoCodecs).toEqual(capabilities.videoCodecs);
    });

    it('leaves the two lists equal when there is no MediaSource path at all', () => {
      const capabilities = detectWebMediaCodecCapabilities(element);
      expect(capabilities.hlsVideoCodecs).toEqual(capabilities.videoCodecs);
    });
  });
});

describe('hlsDeliveryProbe', () => {
  const HLS = 'application/vnd.apple.mpegurl';

  it('prefers the MediaSource probe, which is the decoder hls.js will use', () => {
    const mse = probeFrom(['video/mp4; codecs="avc1.42E01E"']);
    expect(hlsDeliveryProbe(probeFrom([HLS]), mse)).toBe(mse);
  });

  it('asks the engine about the playlist type when the native player will drive', () => {
    const probe = probeFrom([HLS, `${HLS}; codecs="mp4a.40.2"`]);
    const delivery = hlsDeliveryProbe(probe);

    // Rewritten from the fMP4 mime the caller passes to the playlist type the
    // native pipeline is actually asked about.
    expect(delivery?.('audio/mp4; codecs="mp4a.40.2"')).toBe(true);
    expect(delivery?.('audio/mp4; codecs="ec-3"')).toBe(false);
  });

  it('discards an engine that accepts a codec which cannot exist', () => {
    // Answers yes to everything, so every answer is the same answer and none
    // of them carry information. Better to fall back than to believe it.
    expect(hlsDeliveryProbe(() => true)).toBeUndefined();
  });

  it('supplies nothing when the engine plays no HLS at all', () => {
    expect(hlsDeliveryProbe(probeFrom(['video/mp4']))).toBeUndefined();
  });
});

describe('HLS delivery codec lists', () => {
  const HLS = 'application/vnd.apple.mpegurl';

  it('narrows audio to what the delivery decoder accepts, not what the element plays', () => {
    // The shape of the Samsung fault: the element plays E-AC-3 in a
    // progressive file, the HLS pipeline does not, and copying it into fMP4
    // produced sound that was present but broken.
    const probe = probeFrom([
      'video/mp4',
      'audio/mp4; codecs="mp4a.40.2"',
      'audio/mp4; codecs="ec-3"',
      HLS,
      `${HLS}; codecs="mp4a.40.2"`,
    ]);
    const capabilities = detectWebMediaCodecCapabilities(probe, undefined, hlsDeliveryProbe(probe));

    expect(capabilities.audioCodecs).toEqual(['aac', 'eac3']);
    expect(capabilities.hlsAudioCodecs).toEqual(['aac']);
  });

  it('leaves both lists equal when no delivery probe is supplied', () => {
    const capabilities = detectWebMediaCodecCapabilities(probeFrom([
      'audio/mp4; codecs="mp4a.40.2"',
      'audio/mp4; codecs="ec-3"',
    ]));

    expect(capabilities.hlsAudioCodecs).toEqual(capabilities.audioCodecs);
  });
});

describe('detectHlsTsSupport', () => {
  it('asks about the transport stream media type directly', () => {
    expect(detectHlsTsSupport(probeFrom(['video/mp2t']))).toBe(true);
    expect(detectHlsTsSupport(probeFrom(['video/mp2t; codecs="avc1.42E01E"']))).toBe(true);
  });

  it('does not infer TS support from HLS support', () => {
    // The two packagings are independent: a set can play fMP4 HLS and refuse
    // MPEG-TS, or the reverse, which is the whole reason this is asked.
    expect(detectHlsTsSupport(probeFrom(['application/vnd.apple.mpegurl', 'video/mp4']))).toBe(false);
  });
});
