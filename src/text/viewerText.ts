import {
  acquisitionError,
  CHOICE_NOT_AVAILABLE_CODE,
  CHOICE_REQUIRED_CODE,
  MachaPlaybackError,
  MachaClusterRouteError,
  MachaEndpointError,
  MachaConnectionError,
  NOT_PLAYABLE_CODE,
  REGENERATION_ENDPOINT_GONE_CODE,
  SESSION_PROVENANCE_UNKNOWN_CODE,
  START_NO_PROGRESS_CODE,
  TOO_SLOW_TO_PLAY_CODE,
  playbackFailureCode,
  playbackFailureDetail,
  qualityLabel,
  startupPhase,
  type CatalogueHintResult,
  type ClusterStartupStatus,
  type MediaSortKey,
  type MediaSummary,
  type MusicHierarchyContext,
  type PlaybackNotice,
  type PlaybackRefusal,
  type PlaybackVersions,
  type PlaybackStartProgress,
  type PlaybackStatusDescription,
  type QualityCeiling,
  type QualityClass,
  type SearchCategoryKey,
  type StartupSubsystem,
  type TorrentJobErrorCode,
  type UpnpErrorCode,
} from '@machafoundation/core';

/**
 * Every word this client shows a viewer about the media and the player.
 * Core supplies structured facts and codes, never sentences.
 */

const pad = (value: number) => String(value).padStart(2, '0');

/** "S01E04", or "Episode 4" with no season. For a list already inside its season. */
export function episodeCode(item: Pick<MediaSummary, 'seasonNumber' | 'episodeNumber'>): string | undefined {
  if (item.episodeNumber === undefined) return undefined;
  return item.seasonNumber === undefined ? `Episode ${item.episodeNumber}` : `S${pad(item.seasonNumber)}E${pad(item.episodeNumber)}`;
}

/**
 * An episode's mark away from its season (search, Continue Watching): "S04E08", the season taken
 * from its context where the item lacks one.
 */
export function episodeLabel(item: Pick<MediaSummary, 'seasonNumber' | 'episodeNumber' | 'playbackContext'>): string | undefined {
  return episodeCode({ episodeNumber: item.episodeNumber, seasonNumber: item.playbackContext?.season.seasonNumber ?? item.seasonNumber });
}

export function seasonLabel(seasonNumber: number | undefined): string | undefined {
  return seasonNumber === undefined ? undefined : `Season ${seasonNumber}`;
}

/** "Track 9", or "Disc 2 · Track 3" past the first disc. */
export function trackNumberLabel(item: Pick<MediaSummary, 'discNumber' | 'trackNumber'>): string | undefined {
  if (item.trackNumber === undefined) return undefined;
  return item.discNumber !== undefined && item.discNumber > 1 ? `Disc ${item.discNumber} · Track ${item.trackNumber}` : `Track ${item.trackNumber}`;
}

/** "Album (1997)", or the title alone with no year and no brackets. */
export function albumLabel(context: MusicHierarchyContext): string {
  return context.album.year ? `${context.album.title} (${context.album.year})` : context.album.title;
}

/**
 * An ordinary card's second line, telling this item from others of its name: a movie or show's
 * year, an episode's code, a season's series, an album's artist, a track's number.
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

/** A sort control has no separate heading; each option reads "Sort By <X>". */
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
 * Words a server code. A known code gets this client's sentence; a `generic` one (something failed
 * underneath) gets that sentence and then the server's; an unknown or absent code (an older node)
 * shows the server's sentence.
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
  duplicate_torrent: 'Another job already held this torrent, so this one was stopped. Remove it and add the torrent again if it is still wanted.',
  torrent_fault: 'The download engine failed on this torrent. Remove it and add the torrent again.',
  adopt_failed: 'No node could take this torrent over. Remove it and add the torrent again.',
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
  path_not_yet_visible: 'Not visible yet; tried again with the next batch',
};

/** A snake_case code as words, for one this client has no sentence for: "no_match" reads "No match". */
export function codeWords(code: string): string {
  return code.replace(/_/g, ' ').replace(/^./, (first) => first.toUpperCase());
}

/** What catalogue matching made of a file. A result that is not a code (an older node sends a sentence) is shown as it is. */
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
  node_not_torrent_capable: 'That node cannot run torrents.',
};

/** A second add of a torrent is refused while a node holds a job for it, in whatever state. */
const TORRENT_ALREADY_ADDED_CODE = 'torrent_already_added';

/**
 * A torrent another node would not take. Read through core's `acquisitionError`, since the cluster
 * router wraps the node's refusal as the cause of its own.
 */
function placementText(caught: unknown): string | undefined {
  const error = acquisitionError(caught);
  if (!error) return undefined;
  if (error.code === TORRENT_ALREADY_ADDED_CODE) return 'That torrent is already in the list. To download it again, remove its job first.';
  if (error.code !== 'placement_failed' || !error.reason) return undefined;
  return PLACEMENT_REASONS[error.reason] ?? JOB_ERRORS[error.reason as TorrentJobErrorCode];
}

/** The server's state on the settings card, where it says anything beyond ok. */
export function serverStatusText(status: { code: string | null; detail: string | null } | undefined): string | undefined {
  if (!status) return undefined;
  if (status.detail) return status.detail;
  return status.code && status.code !== 'ok' ? codeWords(status.code) : undefined;
}

/** Core has dropped the token, but the cluster could not be told. */
export const PLAYLIST_TOO_LARGE_TEXT = 'The playlist is full, so those tracks were not added. Remove some to make room.';
export const SIGN_OUT_UNCONFIRMED_TEXT = 'You are signed out on this device, but the server could not be reached to end the session, so it stays valid there until it expires.';

export const SERVER_UNREACHABLE_TEXT = 'The Macha server cannot be reached. Check that the server is running and that the API address is correct.';

/** Every node was tried and none answered within core's wait. Usually passing, so it says to try again first. */
export const NO_NODE_ANSWERED_TEXT = 'No Macha server answered. Try again in a moment; if it keeps happening, check that the servers are running.';

/** A node in good standing was still working when core's budget for the read ran out: slow, not gone. */
export const SERVER_SLOW_TEXT = 'The server is taking too long to answer. Try again in a moment.';

/** One node did not answer a change in time. A change is never retried on another node, and may still be running. */
export const CHANGE_UNANSWERED_TEXT = 'The server did not answer in time. It may still finish: refresh in a minute before trying again.';

/**
 * What a viewer is told about a thrown error; its `message` is core's log text and never shown.
 * In order: this client's sentence for a code core states, the server's own sentence, the
 * no-node-answered sentence, then `fallback`.
 */
export function viewerErrorText(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  const placed = placementText(error);
  if (placed) return placed;
  const codeText = playbackFailureCodeText(playbackFailureCode(error));
  if (codeText) return codeText;
  const detail = playbackFailureDetail(error);
  if (detail) return detail;
  if (error instanceof MachaConnectionError) return SERVER_UNREACHABLE_TEXT;
  if (error instanceof MachaClusterRouteError && error.slow) return SERVER_SLOW_TEXT;
  if (error instanceof MachaClusterRouteError && error.unreachable) return NO_NODE_ANSWERED_TEXT;
  if (error instanceof MachaEndpointError && error.kind === 'transport') return CHANGE_UNANSWERED_TEXT;
  return fallback;
}

const CHOICE_NAMES: Record<string, string> = {
  audio_stream: 'audio track',
  video_stream: 'video track',
  subtitle_stream: 'subtitle track',
  container: 'streaming format',
};

/** The node is at its transcode limit. The server's sentence is the operator's, so the viewer gets this client's. */
const RESOURCE_LIMIT_CODE = 'resource_limit';

/**
 * Why the node refused a playback change: a stream choice is worded from its code, anything else is
 * the server's sentence, and where nothing said why, it says so.
 */
export function playbackRefusalText(error: unknown, refusal?: PlaybackRefusal): string {
  const code = refusal?.code ?? (error instanceof MachaPlaybackError ? error.code : undefined);
  if (code === RESOURCE_LIMIT_CODE) return 'This node is already converting as much as it can for other viewers. Try again shortly.';
  const choice = refusal?.choice ?? (error instanceof MachaPlaybackError ? error.choice : undefined);
  if (choice) {
    const what = CHOICE_NAMES[choice] ?? choice.replace(/_/g, ' ');
    if (code === CHOICE_NOT_AVAILABLE_CODE) return `The chosen ${what} is not in this file.`;
    if (code === CHOICE_REQUIRED_CODE) return `This file has more than one ${what} and none was chosen.`;
  }
  return viewerErrorText(error, 'The node refused it without saying why.');
}

/** The player's passing notice for one of core's notice codes. */
export function playbackNoticeText(notice: PlaybackNotice, quality?: QualityClass): string {
  switch (notice.code) {
    case 'quality-stepped-down': return qualitySteppedDownText(quality);
    case 'copy-refused': return 'This node could not copy the original streams, so they are being converted.';
    case 'decode-fallback': return 'This device could not play the original streams, so they are being converted.';
    case 'cannot-seek': return 'This stream cannot seek.';
    case 'not-ready': return 'Playback is still loading.';
    case 'instruction-failed': return `Could not start this way: ${playbackRefusalText(notice.error, notice.refusal)}`;
    case 'subtitles-loading': return 'Loading subtitles…';
    case 'update-failed': return `Playback settings were not changed: ${playbackRefusalText(notice.error, notice.refusal)}`;
  }
}

/** The failure screen's sentence for a failure code core states, or undefined to use the server's sentence. */
export function playbackFailureCodeText(code: string | undefined): string | undefined {
  switch (code) {
    case SESSION_PROVENANCE_UNKNOWN_CODE:
    case REGENERATION_ENDPOINT_GONE_CODE:
      return 'This stream is no longer available. Start it again.';
    case NOT_PLAYABLE_CODE:
      return 'This item cannot be played here.';
    // Core's own code, with no server sentence behind it.
    case START_NO_PROGRESS_CODE:
      return 'The node stopped making progress starting this stream.';
    case TOO_SLOW_TO_PLAY_CODE:
      return tooSlowToPlayText();
    default:
      return undefined;
  }
}

/** The player's stream-status lines, e.g. "DIRECT · HEVC · 1920×1080 · 7.5 Mb/s". */
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

/** A whole percentage of `done` over `total`, when the node measured both. */
function measuredPercent(done: number | undefined, total: number | undefined): number | undefined {
  if (done === undefined || total === undefined || !Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return undefined;
  return Math.min(100, Math.max(0, Math.floor(done / total * 100)));
}

/**
 * What a start or a change is doing, from core's counters: the stage, and how far through it. Never
 * an estimate: an unreported counter shows no figure. `node` names where the work happens;
 * `standalone` ends an open stage with an ellipsis.
 */
export function startProgressText(progress: PlaybackStartProgress, node?: string, standalone = false): string | undefined {
  const on = node ? ` on ${node}` : '';
  const change = progress.kind === 'change';
  const words = progress.stage === 'planning' ? `${change ? 'Preparing new stream' : 'Preparing the stream'}${on}`
    : progress.stage === 'preroll' ? `Finding the start point${change ? on : ''}`
      : progress.stage === 'encoding' ? (change ? `Starting the new stream${on}` : 'Starting the stream')
        : undefined;
  if (!words) return undefined;
  const percent = progress.stage === 'preroll' ? measuredPercent(progress.prerollDecodedMs, progress.prerollTotalMs)
    : progress.stage === 'encoding' ? measuredPercent(progress.outputMediaMs, progress.firstFragmentMs)
      : undefined;
  if (percent !== undefined) return `${words}: ${percent}%`;
  return standalone ? `${words}…` : words;
}

/** The scrubber's clock: "1:23:45", or "4:05" under an hour; "0:00" for anything not a positive finite duration. */
export function playbackTimeText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** The alphabet index's catch-all key reads "#". */
export function alphabetIndexKeyText(key: string): string {
  return key === 'other' ? '#' : key;
}

export function alphabetIndexKeyDescription(key: string): string {
  return key === 'other' ? 'Titles beginning with a number or symbol' : `Titles beginning with ${key}`;
}

/** "its video", "its audio", "its video and audio", or undefined for neither. */
function convertedStreams(video: boolean, audio: boolean): string | undefined {
  return video && audio ? 'its video and audio' : video ? 'its video' : audio ? 'its audio' : undefined;
}

/**
 * A chosen quality that no node can convert at real speed (core's `TOO_SLOW_TO_PLAY_CODE`), naming
 * the quality and the converted streams where they are known.
 */
export function tooSlowToPlayText(quality?: QualityClass, transform?: { video: string; audio: string }): string {
  const streams = transform && convertedStreams(transform.video === 'transcode', transform.audio === 'transcode');
  return `Macha can't play ${quality ? qualityLabel(quality) : 'this quality'} because the server can't convert ${streams ?? 'it'} fast enough to keep up.`;
}

/** Core stepped its own choice down to a quality a node can keep up with. */
export function qualitySteppedDownText(quality?: QualityClass): string {
  return `Switched to ${quality ? qualityLabel(quality) : 'a lower quality'}: the server can't convert a higher quality fast enough.`;
}

/**
 * Why Play chooses the file it does, as one sentence from `PlaybackVersions`: the file chosen, a
 * larger one passed over for needing conversion (`passedOver`), and a ceiling that kept one out
 * (`limitedBy`). Undefined when Play is choosing the largest file there is.
 */
export function qualityChoiceText(versions: Pick<PlaybackVersions, 'files' | 'automatic' | 'limitedBy' | 'passedOver'>): string | undefined {
  const { automatic, limitedBy, passedOver } = versions;
  if (!automatic) return undefined;
  const clauses: string[] = [];
  const converted = passedOver && convertedStreams(passedOver.converts.video, passedOver.converts.audio);
  // The node's measured rate makes the conversion too slow to watch.
  const tooSlow = passedOver?.reasons.includes('transcode-below-real-time');
  if (passedOver && converted) {
    clauses.push(`${qualityLabel(passedOver.quality)} needs ${converted} converted${tooSlow ? ', which the server can\'t do fast enough' : ''}`);
  }
  const above = limitedBy
    ? Math.max(...versions.files.map((file) => file.quality).filter((quality) => quality > limitedBy.quality))
    : Number.NEGATIVE_INFINITY;
  if (limitedBy && Number.isFinite(above)) {
    const larger = qualityLabel(above as QualityCeiling['quality']);
    clauses.push(limitedBy.reason === 'ceiling-display' ? `${larger} is more than this screen shows`
      : limitedBy.reason === 'ceiling-device' ? `${larger} is more than this device plays`
        : limitedBy.reason === 'ceiling-cellular' ? `${larger} is more than Play uses on mobile data`
          : `${larger} is more than the most set in Settings`);
  }
  if (clauses.length === 0) return undefined;
  const plays = automatic.instruction.video !== 'transcode' && automatic.instruction.audio !== 'transcode';
  const chosen = `Play chooses ${qualityLabel(automatic.quality)}${passedOver && converted && plays ? ', which plays without converting' : ''}.`;
  return `${chosen} ${clauses.join(', and ')}. Pick a quality to play another.`;
}

const AVAILABILITY_NOUN: Record<string, string> = {
  movie: 'film', show: 'series', season: 'season', episode: 'episode', artist: 'artist\'s music', album: 'album', track: 'track',
};
const MEMBER_NOUN: Record<string, string> = { show: 'episodes', season: 'episodes', artist: 'tracks', album: 'tracks' };

/**
 * An availability marker's tooltip. Unavailable means no reachable node holds the pieces, which is
 * not the same as lost. A container with counts says how its members stand.
 */
export function availabilityText(
  mark: 'partial' | 'unavailable' | 'unknown',
  kind?: string,
  members?: { total: number; complete: number; partial: number; unavailable: number; unknown: number },
): string {
  const noun = (kind && AVAILABILITY_NOUN[kind]) || 'title';
  const memberNoun = kind ? MEMBER_NOUN[kind] : undefined;
  if (mark === 'unknown') return `Macha hasn't yet checked which servers hold this ${noun}. It plays as normal.`;
  if (mark === 'unavailable') {
    return memberNoun
      ? `Everything in this ${noun} is held only by servers that can't be reached right now, so none of it can be played.`
      : `This ${noun} is held only by servers that can't be reached right now, so it can't be played.`;
  }
  if (!memberNoun) return `Part of this ${noun} is held only by servers that can't be reached right now, so it may stop before the end.`;
  const counts = members && members.total > 0
    ? [
      members.complete > 0 ? `${members.complete} of ${members.total} ${memberNoun} in full` : undefined,
      members.partial > 0 ? `${members.partial} in part` : undefined,
      members.unavailable > 0 ? `${members.unavailable} not at all` : undefined,
      members.unknown > 0 ? `${members.unknown} not yet checked` : undefined,
    ].filter(Boolean).join(', ')
    : '';
  return `Some of this ${noun} is held only by servers that can't be reached right now${counts ? `: ${counts}` : ''}.`;
}
