import {
  MachaConnectionError,
  NOT_PLAYABLE_CODE,
  REGENERATION_ENDPOINT_GONE_CODE,
  SESSION_PROVENANCE_UNKNOWN_CODE,
  playbackFailureCode,
  playbackFailureDetail,
  startupPhase,
  type ClusterStartupStatus,
  type MediaSortKey,
  type MediaSummary,
  type MusicHierarchyContext,
  type PlaybackNotice,
  type PlaybackStatusDescription,
  type SearchCategoryKey,
  type StartupSubsystem,
} from '@machafoundation/core';

/**
 * Every word this client shows a viewer about the media and the player that
 * core used to compose for it.
 *
 * Tom's ruling, 2026-09-24: core handles no viewer text at all. It hands over
 * structured facts (season, episode, disc and track numbers, the series,
 * album and artist an item belongs to, sort and category keys) and codes in
 * place of sentences, and each client words them. Wording carried over from
 * core keeps what viewers already read, except where Tom has ruled
 * otherwise; the rulings are noted where they apply.
 */

const pad = (value: number) => String(value).padStart(2, '0');

/** "S01E04", or "Episode 4" with no season. For a list already inside its season. */
export function episodeCode(item: Pick<MediaSummary, 'seasonNumber' | 'episodeNumber'>): string | undefined {
  if (item.episodeNumber === undefined) return undefined;
  return item.seasonNumber === undefined ? `Episode ${item.episodeNumber}` : `S${pad(item.seasonNumber)}E${pad(item.episodeNumber)}`;
}

/**
 * "Season 1 Episode 4", or "Episode 4" with no season. Tom's ruling for an
 * episode shown away from its season: search and Continue Watching.
 */
export function episodeLabel(item: Pick<MediaSummary, 'seasonNumber' | 'episodeNumber' | 'playbackContext'>): string | undefined {
  if (item.episodeNumber === undefined) return undefined;
  const season = item.playbackContext?.season.seasonNumber ?? item.seasonNumber;
  return season === undefined ? `Episode ${item.episodeNumber}` : `Season ${season} Episode ${item.episodeNumber}`;
}

export function seasonLabel(seasonNumber: number | undefined): string | undefined {
  return seasonNumber === undefined ? undefined : `Season ${seasonNumber}`;
}

/** "Track 9", or "Disc 2 · Track 3" past the first disc. */
export function trackNumberLabel(item: Pick<MediaSummary, 'discNumber' | 'trackNumber'>): string | undefined {
  if (item.trackNumber === undefined) return undefined;
  return item.discNumber !== undefined && item.discNumber > 1 ? `Disc ${item.discNumber} · Track ${item.trackNumber}` : `Track ${item.trackNumber}`;
}

/** "Homogenic (1997)", or the title alone with no year and no brackets. */
export function albumLabel(context: MusicHierarchyContext): string {
  return context.album.year ? `${context.album.title} (${context.album.year})` : context.album.title;
}

/**
 * The second line of an ordinary card: what distinguishes this item from
 * others of its name. A movie or show its year; an episode its code; a
 * season found outside its series that series; an album its artist (Tom:
 * on Music the artist sits below the album name); a track its number.
 */
export function cardSubtitle(item: MediaSummary): string | undefined {
  switch (item.kind) {
    case 'episode': return episodeCode(item);
    case 'season': {
      const series = item.playbackContext?.series.title;
      const season = seasonLabel(item.seasonNumber);
      return series && season ? `${series} · ${season}` : season;
    }
    case 'album': return item.musicContext?.artist?.title ?? (item.year !== undefined ? String(item.year) : undefined);
    case 'track': return trackNumberLabel(item);
    case 'artist': return undefined;
    default: return item.year !== undefined ? String(item.year) : undefined;
  }
}

const SORT_LABELS: Record<MediaSortKey, string> = {
  relevance: 'Relevance',
  title: 'Title',
  year: 'Year',
  recent: 'Recently added',
};

/** Tom: a sort control has no separate heading; each option reads "Sort By <X>". */
export function sortChoiceLabel(key: MediaSortKey): string {
  return `Sort By ${SORT_LABELS[key]}`;
}

const CATEGORY_LABELS: Record<SearchCategoryKey, string> = {
  movies: 'Movies',
  shows: 'TV Shows',
  music: 'Music',
};

export function searchCategoryLabel(key: SearchCategoryKey): string {
  return CATEGORY_LABELS[key];
}

export function startupPhaseLabel(startup: ClusterStartupStatus): string {
  switch (startupPhase(startup)) {
    case 'ready': return 'Ready';
    case 'recovering': return 'Recovering';
    case 'failed': return 'Startup failed';
    default: return 'Starting';
  }
}

const SUBSYSTEM_LABELS: Record<StartupSubsystem['key'], string> = {
  api: 'Status API',
  control_plane: 'Cluster control',
  data_storage: 'DATA storage',
  control_storage: 'CONTROL storage',
  cache: 'Cache',
  retention: 'Retention',
  metadata: 'Metadata',
  services: 'Local services',
};

export function startupSubsystemLabel(key: StartupSubsystem['key']): string {
  return SUBSYSTEM_LABELS[key];
}

export const SERVER_UNREACHABLE_TEXT = 'The Macha server cannot be reached. Check that the server is running and that the API address is correct.';

/**
 * What a viewer is told about a thrown error. An error's `message` is core's
 * log text and never shown. In order: this client's sentence for a code core
 * states, the server's own sentence from wherever in the chain it was said,
 * this client's sentence for no node answering, and last the caller's
 * general line.
 */
export function viewerErrorText(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  const code = playbackFailureCode(error);
  const coded = playbackFailureCodeText(code);
  if (coded) return coded;
  const detail = playbackFailureDetail(error);
  if (detail) return detail;
  if (error instanceof MachaConnectionError) return SERVER_UNREACHABLE_TEXT;
  return fallback;
}

/** The player's passing notice for one of core's notice codes. */
export function playbackNoticeText(notice: PlaybackNotice): string {
  switch (notice.code) {
    case 'copy-refused': return 'This node could not copy the original streams, so they are being converted.';
    case 'cannot-seek': return 'This stream cannot seek.';
    case 'not-ready': return 'Playback is still loading.';
    case 'instruction-failed': return 'Could not work out how to play this here.';
    case 'subtitles-loading': return 'Loading subtitles…';
    case 'update-failed': return 'That change could not be made.';
  }
}

/**
 * The failure screen's sentence for a failure core states by code, or
 * undefined for one it does not, where the server's own sentence (or the
 * screen's general one) applies.
 */
export function playbackFailureCodeText(code: string | undefined): string | undefined {
  switch (code) {
    case SESSION_PROVENANCE_UNKNOWN_CODE:
    case REGENERATION_ENDPOINT_GONE_CODE:
      return 'This stream is no longer available. Start it again.';
    case NOT_PLAYABLE_CODE:
      return 'This item cannot be played here.';
    default:
      return undefined;
  }
}

/**
 * The player's stream-status lines, from core's description of the session.
 * Worded exactly as core used to word them, so a viewer sees no change:
 * "DIRECT · HEVC · 1920×1080 · 7.5 Mb/s", "AUDIO TRANSCODE · SOURCE · … → …".
 */
const CONTAINER_LABELS: Record<string, string> = { fmp4: 'FMP4', mpegts: 'MPEG-TS' };

function bitrateText(bitrate?: number): string {
  if (!bitrate) return '';
  return bitrate >= 1_000_000 ? `${(bitrate / 1_000_000).toFixed(1)} Mb/s` : `${Math.round(bitrate / 1000)} kb/s`;
}

function channelsText(channels?: number): string {
  if (!channels) return '';
  if (channels === 1) return 'mono';
  if (channels === 2) return 'stereo';
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  return `${channels}ch`;
}

function sampleRateText(sampleRate?: number): string {
  if (!sampleRate) return '';
  return sampleRate >= 1_000 ? `${Number((sampleRate / 1_000).toFixed(1))} kHz` : `${sampleRate} Hz`;
}

function present(parts: Array<string | undefined>): string[] {
  return parts.filter((part): part is string => Boolean(part));
}

function videoSourceParts(video: NonNullable<PlaybackStatusDescription['video']>): string[] {
  const { source } = video;
  return present([
    source.codec.toUpperCase(),
    source.width && source.height ? `${source.width}×${source.height}` : undefined,
    bitrateText(source.bitrate || video.sourceBitrate),
  ]);
}

function videoOutputParts(video: NonNullable<PlaybackStatusDescription['video']>): string[] {
  const output = video.output;
  if (!output) return [];
  return present([
    output.codec?.toUpperCase(),
    output.width && output.height ? `${output.width}×${output.height}` : undefined,
    bitrateText(output.bitrate ?? video.outputBitrate),
  ]);
}

function audioParts(stream: { codec?: string; language?: string; channels?: number; sampleRate?: number; bitDepth?: number; bitrate?: number }, withLanguage: boolean): string[] {
  return present([
    withLanguage && stream.language ? stream.language.toUpperCase() : undefined,
    stream.codec?.toUpperCase(),
    channelsText(stream.channels),
    sampleRateText(stream.sampleRate),
    stream.bitDepth ? `${stream.bitDepth}-bit` : undefined,
    bitrateText(stream.bitrate),
  ]);
}

function transcoded(kind: 'VIDEO' | 'AUDIO', source: string[], output: string[]): string {
  const described = [`${kind} TRANSCODE`, 'SOURCE', ...source].join(' · ');
  return output.length ? `${described} → ${output.join(' · ')}` : described;
}

export interface StreamStatusText {
  container?: string;
  video?: string;
  audio?: string;
  subtitle?: string;
}

export function streamStatusText(description: PlaybackStatusDescription | undefined): StreamStatusText | undefined {
  if (!description) return undefined;
  const whole = description.delivery === 'direct' ? 'DIRECT' : description.delivery === 'remux' ? 'REMUX' : undefined;
  const { video, audio, subtitle } = description;
  return {
    container: description.container ? CONTAINER_LABELS[description.container.toLowerCase()] ?? description.container.toUpperCase() : undefined,
    video: video && (video.transform === 'transcode'
      ? transcoded('VIDEO', videoSourceParts(video), videoOutputParts(video))
      : [whole ?? 'VIDEO COPY', ...videoSourceParts(video)].join(' · ')),
    audio: audio && (audio.transform === 'transcode'
      ? transcoded('AUDIO', audioParts(audio.source, true), audio.output ? audioParts(audio.output, false) : [])
      : [whole ?? 'AUDIO COPY', ...audioParts(audio.source, true)].join(' · ')),
    subtitle: subtitle && ['SUBTITLES', subtitle.language ? subtitle.language.toUpperCase() : 'UND', subtitle.codec.toUpperCase(), ...(subtitle.forced ? ['FORCED'] : [])].join(' · '),
  };
}

/**
 * The scrubber's clock: "1:23:45", or "4:05" under an hour. Anything not a
 * positive finite duration reads "0:00", since there is no position to show
 * yet; that is a placeholder carried over from core, not a decision.
 */
export function playbackTimeText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** The alphabet index's catch-all key reads "#", as it always has. */
export function alphabetIndexKeyText(key: string): string {
  return key === 'other' ? '#' : key;
}

export function alphabetIndexKeyDescription(key: string): string {
  return key === 'other' ? 'Titles beginning with a number or symbol' : `Titles beginning with ${key}`;
}
