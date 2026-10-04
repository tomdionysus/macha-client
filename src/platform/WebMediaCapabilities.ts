export interface WebMediaCodecCapabilities {
  videoCodecs: string[];
  /** The subset of `videoCodecs` the HLS delivery decoder accepts; all of them where no delivery probe was supplied. */
  hlsVideoCodecs: string[];
  audioCodecs: string[];
  /** The subset of `audioCodecs` the HLS delivery decoder accepts, which can be narrower than the progressive-file decoder. */
  hlsAudioCodecs: string[];
  containers: string[];
  /** Deepest sample depth decoded: 8 unless a 10- or 12-bit profile probes true. A deeper source is the server's cue to transcode. */
  videoBitDepth: number;
  /** Dolby Vision profile numbers this client decodes. Empty means none, never "unknown". */
  dolbyVision: number[];
  /** HDR transfers this client can present, not merely decode: needs both a deep-colour decoder and an HDR display path. */
  hdrTransfers: string[];
}

type MimeProbe = (mime: string) => boolean;

/** `matchMedia`-style probe, absent on engines old enough not to have it. */
export type MediaFeatureProbe = (query: string) => boolean;

const TEN_BIT_PROFILES = [
  'video/mp4; codecs="hev1.2.4.L120.B0"',
  'video/mp4; codecs="hvc1.2.4.L120.B0"',
  'video/webm; codecs="vp09.02.10.10"',
  'video/mp4; codecs="av01.0.05M.10"',
] as const;

/** Dolby Vision profiles, probed individually: a set often handles 8 but not 5. Both fourCCs are tried, since engines differ. */
const DOLBY_VISION_PROFILES: ReadonlyArray<readonly [profile: number, codecs: readonly string[]]> = [
  [4, ['dvhe.04.06', 'dvh1.04.06']],
  [5, ['dvhe.05.06', 'dvh1.05.06']],
  [7, ['dvhe.07.06', 'dvh1.07.06']],
  [8, ['dvhe.08.09', 'dvh1.08.09']],
  [9, ['dvav.09.06', 'dva1.09.06']],
];

const TWELVE_BIT_PROFILES = [
  'video/mp4; codecs="av01.0.05M.12"',
  'video/webm; codecs="vp09.03.10.12"',
] as const;

function anySupported(probe: MimeProbe, mimeTypes: readonly string[]): boolean {
  return mimeTypes.some((mime) => probe(mime));
}

/** The type a native HLS pipeline is asked about. */
const HLS_MIME = 'application/vnd.apple.mpegurl';

/** Both spellings are asked, because engines disagree on the name. */
const MATROSKA_MIMES = ['video/x-matroska', 'video/matroska'] as const;
const MATROSKA_CODECS = ['avc1.42E01E', 'hvc1.1.6.L93.B0'] as const;

/**
 * Whether this engine demuxes Matroska. Some elements accept the container and
 * render corrupt video, so an engine that also accepts an impossible codec
 * inside it is not believed. A container claim says nothing about the audio
 * inside; the chooser objects per stream.
 */
export function detectMatroskaSupport(probe: MimeProbe): boolean {
  return MATROSKA_MIMES.some((mime) =>
    !probe(`${mime}; codecs="zzzz.invalid"`)
    && anySupported(probe, MATROSKA_CODECS.map((codec) => `${mime}; codecs="${codec}"`)));
}

/**
 * Whether this engine takes HLS segments as MPEG-TS. Asked separately from
 * fMP4: an older native HLS player can be sound at one packaging and broken at the other.
 */
export function detectHlsTsSupport(probe: MimeProbe): boolean {
  return anySupported(probe, ['video/mp2t', 'video/mp2t; codecs="avc1.42E01E"']);
}

/**
 * What the HLS delivery decoder accepts: MediaSource under hls.js, otherwise
 * the engine asked about the playlist type. An engine that accepts an
 * impossible codec is not reading `codecs`, so undefined is returned and the
 * element's list stands. A type with no `codecs` parameter is asked as it is.
 */
export function hlsDeliveryProbe(probe: MimeProbe, mseProbe?: MimeProbe): MimeProbe | undefined {
  if (mseProbe !== undefined) return mseProbe;
  if (!probe(HLS_MIME)) return undefined;
  if (probe(`${HLS_MIME}; codecs="zzzz.invalid"`)) return undefined;
  return (mime) => mime.includes('codecs=')
    ? probe(mime.replace(/^[a-z]+\/[\w.+-]+/, HLS_MIME))
    : probe(mime);
}

/**
 * @param probe        `canPlayType`: what the media element decodes.
 * @param mediaFeature `matchMedia`, for the dynamic-range claim.
 * @param deliveryProbe what the HLS delivery decoder accepts, from
 *   `hlsDeliveryProbe`. Supply it whenever delivery goes through HLS: that
 *   decoder is often narrower than the element, and over-claiming loses the
 *   title where under-claiming only costs a transcode.
 */
export function detectWebMediaCodecCapabilities(
  probe: MimeProbe,
  mediaFeature?: MediaFeatureProbe,
  deliveryProbe?: MimeProbe,
): WebMediaCodecCapabilities {
  const videoCodecs: string[] = [];
  const hlsVideoCodecs: string[] = [];
  const audioCodecs: string[] = [];
  const hlsAudioCodecs: string[] = [];
  // The element decides whether a codec is claimed; the delivery decoder, whether it survives HLS.
  const claim = (into: string[], hlsInto: string[]) => (codec: string, mimeTypes: readonly string[]) => {
    if (!anySupported(probe, mimeTypes)) return;
    into.push(codec);
    if (deliveryProbe === undefined || anySupported(deliveryProbe, mimeTypes)) hlsInto.push(codec);
  };
  const claimVideo = claim(videoCodecs, hlsVideoCodecs);
  const claimAudio = claim(audioCodecs, hlsAudioCodecs);

  claimVideo('h264', ['video/mp4; codecs="avc1.42E01E"']);
  claimVideo('hevc', ['video/mp4; codecs="hev1.1.6.L93.B0"', 'video/mp4; codecs="hvc1.1.6.L93.B0"']);
  claimVideo('vp9', ['video/webm; codecs="vp9"']);
  claimVideo('av1', ['video/mp4; codecs="av01.0.05M.08"']);

  claimAudio('aac', ['audio/mp4; codecs="mp4a.40.2"', 'video/mp4; codecs="mp4a.40.2"']);
  claimAudio('opus', ['audio/webm; codecs="opus"', 'video/webm; codecs="opus"']);
  claimAudio('vorbis', ['audio/ogg; codecs="vorbis"']);
  // ISO BMFF identifiers matter for the remux path; raw MIME names are fallbacks for browsers that expose Dolby that way.
  claimAudio('ac3', ['audio/mp4; codecs="ac-3"', 'video/mp4; codecs="ac-3"', 'audio/ac3', 'audio/x-ac3']);
  claimAudio('eac3', ['audio/mp4; codecs="ec-3"', 'video/mp4; codecs="ec-3"', 'audio/eac3', 'audio/x-eac3']);
  claimAudio('mp3', ['audio/mpeg']);
  claimAudio('flac', ['audio/flac']);

  const containers: string[] = [];
  if (probe('video/mp4') || probe('audio/mp4')) containers.push('mp4');
  if (probe('video/webm') || probe('audio/webm')) containers.push('webm');
  if (detectMatroskaSupport(probe)) containers.push('matroska');
  if (probe('audio/mpeg')) containers.push('mp3');
  if (probe('audio/flac')) containers.push('flac');
  if (probe('audio/ogg')) containers.push('ogg');

  const videoBitDepth = anySupported(probe, TWELVE_BIT_PROFILES) ? 12
    : anySupported(probe, TEN_BIT_PROFILES) ? 10
      : 8;

  // Needs both a deep enough decoder and a display path that claims HDR; engines without the media query claim nothing.
  const highDynamicRange = videoBitDepth >= 10 && mediaFeature !== undefined && [
    '(video-dynamic-range: high)',
    '(dynamic-range: high)',
  ].some((query) => mediaFeature(query));

  // A DV fourCC embeds an HEVC profile, so an engine can say yes on the base layer alone; require the HDR presentation path too.
  const dolbyVision = highDynamicRange
    ? DOLBY_VISION_PROFILES
      .filter(([, codecs]) => anySupported(probe, codecs.map((codec) => `video/mp4; codecs="${codec}"`)))
      .map(([profile]) => profile)
    : [];

  return {
    videoCodecs,
    hlsVideoCodecs,
    audioCodecs,
    hlsAudioCodecs,
    containers,
    videoBitDepth,
    dolbyVision,
    hdrTransfers: highDynamicRange ? ['smpte2084', 'arib-std-b67'] : [],
  };
}
