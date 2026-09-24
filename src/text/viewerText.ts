import {
  MachaAcquisitionApiError,
  MachaConnectionError,
  NOT_PLAYABLE_CODE,
  REGENERATION_ENDPOINT_GONE_CODE,
  SESSION_PROVENANCE_UNKNOWN_CODE,
  playbackFailureCode,
  playbackFailureDetail,
  startupPhase,
  type CatalogueHintResult,
  type ClusterStartupStatus,
  type MediaSortKey,
  type MediaSummary,
  type MusicHierarchyContext,
  type PlaybackNotice,
  type PlaybackStatusDescription,
  type SearchCategoryKey,
  type StartupSubsystem,
  type TorrentJobErrorCode,
  type UpnpErrorCode,
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

/**
 * Server 0.56.0 puts a code beside every sentence it sends, and the code is
 * what this client words. One rule for all of them: a code this client knows
 * gets its sentence here; a code that says only that something went wrong
 * underneath (libtorrent's error, a storage error) gets its sentence and then
 * the server's, which is where the substance is; a code this client does not
 * know, or none from a node older than 0.56.0, shows the server's sentence.
 */
function coded<C extends string>(words: Partial<Record<C, string>>, generic: ReadonlySet<string>, code: string | null | undefined, detail: string | null | undefined): string | undefined {
  const sentence = code ? words[code as C] : undefined;
  if (!sentence) return detail || undefined;
  return generic.has(code as string) && detail ? `${sentence} ${detail}` : sentence;
}

const JOB_ERRORS: Record<TorrentJobErrorCode, string> = {
  source_unavailable: 'The source cannot be reached.',
  source_not_regular: 'The source is not an ordinary file.',
  source_scan_interrupted: 'Scanning the source was interrupted.',
  source_changed_during_scan: 'The source changed while it was being scanned.',
  source_disappeared: 'The source has gone.',
  source_changed: 'The source changed while it was being copied.',
  source_unreadable: 'The source cannot be read.',
  source_seek_failed: 'The source could not be read in full.',
  source_short_read: 'The source could not be read in full.',
  source_is_symlink: 'The source is a symbolic link, and links are not imported.',
  no_supported_media: 'No playable media was found in it.',
  destination_parent_not_directory: 'Where it was to be stored is not a folder.',
  partial_not_file: 'A half-copied file is in the way.',
  destination_conflict: 'A file of that name is already stored there.',
  namespace_short_write: 'The copy was cut short while it was written.',
  size_mismatch: 'The copy is not the same size as the source.',
  metadata_unavailable: 'The file\'s details could not be read.',
  filesystem_error: 'A storage error stopped the import.',
  import_failed: 'The import failed.',
  restore_failed: 'The torrent could not be restored after a restart.',
  ingest_missing: 'Its import has gone missing.',
  ingest_cancelled: 'Its import was cancelled.',
  torrent_error: 'The torrent reported an error.',
  staging_full: 'Waiting for room in staging.',
  ingest_submit_failed: 'It could not be handed over for import.',
  ingest_failed: 'Its import failed.',
  torrent_failed: 'The download failed.',
};
const GENERIC_JOB_ERRORS = new Set(['filesystem_error', 'import_failed', 'torrent_error', 'torrent_failed', 'ingest_failed']);

/** Why an import or torrent job failed or is blocked. Undefined when it has not. */
export function jobErrorText(job: { error?: string | null; error_code?: string | null } | undefined): string | undefined {
  return job ? coded(JOB_ERRORS, GENERIC_JOB_ERRORS, job.error_code, job.error) : undefined;
}

const HINT_RESULTS: Record<CatalogueHintResult, string> = {
  matched: 'Matched',
  outside_catalogue_roots: 'Outside the catalogue folders',
  not_media_file: 'Not a media file',
  no_media_candidate: 'Nothing recognisable',
  no_provider_match: 'No match found',
  already_stored: 'Already in the catalogue',
  profile_prepared: 'Prepared',
  media_not_live: 'Not live yet',
  manual_existing_item: 'Matched by hand',
  manual_metadata: 'Entered by hand',
};

/** A snake_case code as words, for one this client has no sentence for: "no_match" reads "No match". */
export function codeWords(code: string): string {
  return code.replace(/_/g, ' ').replace(/^./, (first) => first.toUpperCase());
}

/** What catalogue matching made of a file. A node older than 0.56.0 sends a sentence, shown as it is. */
export function hintResultLabel(result: string): string {
  if (result in HINT_RESULTS) return HINT_RESULTS[result as CatalogueHintResult];
  return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(result) ? codeWords(result) : result;
}

const DIAGNOSTIC_ERRORS: Record<UpnpErrorCode | 'lookup_failed' | 'recovery_failed' | 'rpc_failed', string> = {
  igd_not_connected: 'The router\'s UPnP gateway is not connected.',
  port_mapped_elsewhere: 'The router maps this port to another device.',
  mapping_verification_failed: 'The router did not confirm the port mapping.',
  add_mapping_failed: 'The router refused the port mapping.',
  discovery_failed: 'No UPnP router was found.',
  support_not_built: 'This server was built without UPnP.',
  lookup_failed: 'The external address could not be looked up.',
  recovery_failed: 'Recovery at startup failed.',
  rpc_failed: 'The node did not answer.',
};
const NO_GENERIC = new Set<string>();

/** A status diagnostic's error: UPnP, external address, startup, a node's reachability. */
export function diagnosticErrorText(item: { error?: string | null; error_code?: string | null }): string | undefined {
  return coded(DIAGNOSTIC_ERRORS, NO_GENERIC, item.error_code, item.error);
}

const PLACEMENT_REASONS: Record<string, string> = {
  node_not_member: 'That node is not in this cluster.',
  node_refused: 'That node refused the torrent.',
  node_unreachable: 'That node cannot be reached.',
  node_did_not_start: 'That node did not start the torrent.',
  missing_uri: 'There was no magnet link to pass on.',
  add_failed: 'That node could not add the torrent.',
};

/** A torrent another node would not take: by its reason, or the peer's own code where that is a job's. */
function placementText(error: unknown): string | undefined {
  if (!(error instanceof MachaAcquisitionApiError) || error.code !== 'placement_failed' || !error.reason) return undefined;
  return PLACEMENT_REASONS[error.reason] ?? JOB_ERRORS[error.reason as TorrentJobErrorCode];
}

/** The server's state on the settings card, where it says anything beyond ok. */
export function serverStatusText(status: { code: string | null; detail: string | null } | undefined): string | undefined {
  if (!status) return undefined;
  if (status.detail) return status.detail;
  return status.code && status.code !== 'ok' ? codeWords(status.code) : undefined;
}

/**
 * Signed out here, and the cluster could not be told. Core has already
 * dropped the token, so this device is signed out either way; the session
 * itself stays valid on the server until it expires.
 */
export const SIGN_OUT_UNCONFIRMED_TEXT = 'You are signed out on this device, but the server could not be reached to end the session, so it stays valid there until it expires.';

export const SERVER_UNREACHABLE_TEXT = 'The Macha server cannot be reached. Check that the server is running and that the API address is correct.';

/**
 * What a viewer is told about a thrown error. An error's `message` is core's
 * log text and never shown. In order: this client's sentence for a code core
 * states, the server's own sentence from wherever in the chain it was said,
 * this client's sentence for no node answering, and last the caller's
 * general line.
 */
export function viewerErrorText(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  const placed = placementText(error);
  if (placed) return placed;
  const codeText = playbackFailureCodeText(playbackFailureCode(error));
  if (codeText) return codeText;
  const detail = playbackFailureDetail(error);
  if (detail) return detail;
  if (error instanceof MachaConnectionError) return SERVER_UNREACHABLE_TEXT;
  return fallback;
}

/** The player's passing notice for one of core's notice codes. */
export function playbackNoticeText(notice: PlaybackNotice): string {
  switch (notice.code) {
    case 'copy-refused': return 'This node could not copy the original streams, so they are being converted.';
    case 'decode-fallback': return 'This device could not play the original streams, so they are being converted.';
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
