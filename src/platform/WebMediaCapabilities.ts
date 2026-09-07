export interface WebMediaCodecCapabilities {
  videoCodecs: string[];
  /**
   * The subset of `videoCodecs` the HLS delivery decoder will accept. Equal to
   * `videoCodecs` where no delivery probe was supplied.
   */
  hlsVideoCodecs: string[];
  audioCodecs: string[];
  /**
   * The subset of `audioCodecs` the HLS delivery decoder will accept.
   *
   * Symmetrical with `hlsVideoCodecs` and needed for the same reason: the
   * chooser asks what will survive delivery, and answering that with the
   * progressive-file decoder's opinion is how a set ends up copying E-AC-3
   * into fMP4 that its own HLS pipeline then plays intermittently.
   */
  hlsAudioCodecs: string[];
  containers: string[];
  /**
   * Deepest sample depth this pipeline actually decodes. 8 unless a 10- or
   * 12-bit profile probes true — a source deeper than this is the server's cue
   * to transcode rather than hand over something that decodes to nothing.
   */
  videoBitDepth: number;
  /** Dolby Vision profile numbers this client decodes. Empty means none, never "unknown". */
  dolbyVision: number[];
  /**
   * HDR transfers this client can *present*, not merely decode. Empty unless
   * both a deep-colour decoder and a high-dynamic-range presentation path are
   * established: claiming HDR off a codec probe alone is how a TV ends up
   * displaying PQ content as washed-out SDR.
   */
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

/**
 * Dolby Vision profiles, probed individually rather than as one flag.
 *
 * A set that handles profile 8 but not 5 is common, and a boolean forces it to
 * either over-claim and fail or under-claim and lose titles it could play.
 * Both fourCCs are tried: engines disagree on which they advertise.
 */
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

/** The playlist type a native HLS pipeline is actually asked about. */
const HLS_MIME = 'application/vnd.apple.mpegurl';

/**
 * What the HLS delivery decoder accepts, which is not what the media element
 * accepts for a progressive file.
 *
 * Delivery runs through one of two decoders and neither is the one that
 * answers a plain `canPlayType` for an `.mp4`. With hls.js driving,
 * MediaSource is asked, and it is frequently the narrower of the two. With the
 * platform's own HLS player driving, the engine must be asked about the
 * playlist type instead — nothing else describes that pipeline.
 *
 * The catch is that an engine may not read the `codecs` parameter for a
 * playlist at all, in which case every answer it gives is the same answer and
 * none of them carry information. So it is asked about a codec that cannot
 * exist first: an engine that accepts that is not discriminating, and its
 * opinion is better discarded than believed. Returning undefined then leaves
 * the element's list standing, which is where we already were — this can
 * narrow a claim, never widen one.
 *
 * A raw type carrying no `codecs` parameter — `audio/eac3`, `audio/mpeg` —
 * has no codec to ask about, and rewriting it would ask only whether the
 * engine plays HLS at all, which is yes by the time we are here. There is no
 * question to put, so the element's own answer stands rather than a
 * meaningless yes.
 */
/**
 * Whether this engine can take HLS segments as MPEG-TS.
 *
 * Worth asking separately from `hlsFmp4` rather than assuming one implies the
 * other. They are different packagings and a set can be sound at one and
 * broken at the other — the Samsung is a 2017 panel whose native HLS player
 * predates fMP4 carriage of HEVC and the Dolby codecs, and hands back a black
 * screen, stuttering sound or silence depending on which stream it is given
 * that way. MPEG-TS is what such a player was actually built for.
 *
 * `video/mp2t` is the transport stream's own media type, so this asks the
 * engine about the packaging directly rather than inferring it.
 */
export function detectHlsTsSupport(probe: MimeProbe): boolean {
  return anySupported(probe, ['video/mp2t', 'video/mp2t; codecs="avc1.42E01E"']);
}

export function hlsDeliveryProbe(probe: MimeProbe, mseProbe?: MimeProbe): MimeProbe | undefined {
  if (mseProbe !== undefined) return mseProbe;
  if (!probe(HLS_MIME)) return undefined;
  if (probe(`${HLS_MIME}; codecs="zzzz.invalid"`)) return undefined;
  return (mime) => mime.includes('codecs=')
    ? probe(mime.replace(/^[a-z]+\/[\w.+-]+/, HLS_MIME))
    : probe(mime);
}

/**
 * @param probe        `canPlayType` — what the media element decodes.
 * @param mediaFeature `matchMedia`, for the dynamic-range claim.
 * @param deliveryProbe what the HLS delivery decoder accepts, from
 *   `hlsDeliveryProbe`. Supply it whenever delivery goes through HLS at all,
 *   by either path: MediaSource and the platform's own HLS player are both
 *   different decoders from the media element, and frequently narrower ones. A
 *   TV can decode HEVC Main 10 natively and refuse it through MSE, or accept
 *   E-AC-3 in a progressive file and play it intermittently inside fMP4
 *   segments. Advertising the element's answer for a stream neither will
 *   handle is a black screen or broken sound; the honest claim is the
 *   intersection, because over-claiming loses the title and under-claiming
 *   only costs a transcode.
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
  // The element decides whether we claim the codec at all; the delivery
  // decoder decides whether we claim it survives HLS. Where they differ, the
  // difference is real rather than a probe being pedantic.
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
  // ISO BMFF/fMP4 codec identifiers are the important probes for Macha's
  // remux path. Raw MIME names are retained as compatibility fallbacks for
  // browsers which expose Dolby support that way.
  claimAudio('ac3', ['audio/mp4; codecs="ac-3"', 'video/mp4; codecs="ac-3"', 'audio/ac3', 'audio/x-ac3']);
  claimAudio('eac3', ['audio/mp4; codecs="ec-3"', 'video/mp4; codecs="ec-3"', 'audio/eac3', 'audio/x-eac3']);
  claimAudio('mp3', ['audio/mpeg']);
  claimAudio('flac', ['audio/flac']);

  const containers: string[] = [];
  if (probe('video/mp4') || probe('audio/mp4')) containers.push('mp4');
  if (probe('video/webm') || probe('audio/webm')) containers.push('webm');
  if (probe('audio/mpeg')) containers.push('mp3');
  if (probe('audio/flac')) containers.push('flac');
  if (probe('audio/ogg')) containers.push('ogg');
  // Deliberately not probed: matroska. The Samsung's media element accepts it
  // and renders corrupt video, so `canPlayType` cannot be trusted for it, and
  // claiming it invites the server to serve raw mkv by direct play.

  const videoBitDepth = anySupported(probe, TWELVE_BIT_PROFILES) ? 12
    : anySupported(probe, TEN_BIT_PROFILES) ? 10
      : 8;

  // Both halves are required: a decoder deep enough to carry the signal, and a
  // display path that says it can present it. Older engines expose no such
  // media query at all, which correctly yields no claim.
  const highDynamicRange = videoBitDepth >= 10 && mediaFeature !== undefined && [
    '(video-dynamic-range: high)',
    '(dynamic-range: high)',
  ].some((query) => mediaFeature(query));

  // A DV fourCC embeds an HEVC profile, so an engine can answer true having
  // recognised only the base layer, with nothing having assessed the
  // enhancement layer or the display path. The codec query is therefore not a
  // sufficient oracle on its own, and over-claiming Dolby Vision is the
  // failure that ends in a black screen. Require the same corroboration HDR
  // does — Dolby Vision is an HDR format, so a client that cannot establish an
  // HDR presentation path cannot present it, whatever the string says.
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
