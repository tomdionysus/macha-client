import type { CatalogueMediaProfile } from '@machafoundation/core';

/**
 * The line that says what a file is, as every client shows it. Tom,
 * 2026-09-27: "Copy the web style, formatted for the device screen ... We
 * need all the UIs to match, within the confines of their devices." The
 * phone keeps the same rules in its own mediaLines.ts; the TV follows them.
 * Fields are joined by MEDIA_LINE_SEPARATOR, so a view can keep each field
 * whole and wrap only between them (see MediaLine).
 */
export const MEDIA_LINE_SEPARATOR = ' · ';

function codecLabel(codec: string): string {
  const normalized = codec.trim().toLowerCase();
  if (normalized === 'h264') return 'H.264';
  if (normalized === 'hevc' || normalized === 'h265') return 'HEVC';
  if (normalized === 'aac') return 'AAC';
  if (normalized === 'ac3') return 'AC-3';
  if (normalized === 'eac3') return 'E-AC-3';
  return codec.toUpperCase();
}

function channelsLabel(channels: number): string {
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  return `${channels}ch`;
}

/** A track's length as a player shows it: "3:45", or "1:02:03" past an hour. */
function trackLength(ms: number): string {
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * A file with no picture, as "3:45 · FLAC · 24-bit · 96 kHz · Stereo ·
 * 2,304 kbps": what matters about audio is its resolution in bits and
 * samples, not a picture's. The music extension of the per-file line, as
 * proposed to the TV and phone clients on 2026-09-27.
 */
/**
 * The audio a line names: the file's default track, else its first. A film
 * can carry eight (TrueHD, DTS, AC-3 and more), and the default is the one
 * that plays.
 */
function lineAudio(profile: CatalogueMediaProfile) {
  return profile.streams.find((stream) => stream.type === 'audio' && stream.default)
    ?? profile.streams.find((stream) => stream.type === 'audio');
}

function audioProfileSummary(profile: CatalogueMediaProfile): string {
  const audio = lineAudio(profile);
  const parts: string[] = [];
  if (profile.duration_ms > 0) parts.push(trackLength(profile.duration_ms));
  if (audio?.codec) parts.push(codecLabel(audio.codec));
  if (audio && audio.bit_depth > 0) parts.push(`${audio.bit_depth}-bit`);
  if (audio && audio.sample_rate > 0) parts.push(`${Number((audio.sample_rate / 1000).toFixed(1))} kHz`);
  if (audio && audio.channels > 0) parts.push(channelsLabel(audio.channels));
  if (profile.bitrate > 0) parts.push(`${Math.round(profile.bitrate / 1000).toLocaleString('en-GB')} kbps`);
  return parts.join(MEDIA_LINE_SEPARATOR);
}

export function mediaProfileSummary(profile: CatalogueMediaProfile): string {
  if (!profile.streams.some((stream) => stream.type === 'video' && !stream.attached_picture)) return audioProfileSummary(profile);
  const parts: string[] = [];
  const minutes = Math.floor(profile.duration_ms / 60_000);
  if (minutes >= 60) parts.push(`${Math.floor(minutes / 60)}h ${minutes % 60}m`);
  else if (minutes > 0) parts.push(`${minutes}m`);
  const video = profile.streams.find((stream) => stream.type === 'video' && !stream.attached_picture);
  const audio = lineAudio(profile);
  if (video?.width && video.height) parts.push(`${video.width}×${video.height}`);
  if (video?.codec) parts.push(codecLabel(video.codec));
  if (audio?.codec) parts.push(codecLabel(audio.codec));
  if (profile.bitrate > 0) parts.push(`${(profile.bitrate / 1_000_000).toFixed(1)} Mbps`);
  return parts.join(MEDIA_LINE_SEPARATOR);
}

/**
 * One line per file's format, with files that read the same (length,
 * resolution, codecs and bitrate) combined into one line (Tom, 2026-09-27).
 *
 * TODO: files identical in all of these are very likely the same media
 * stored twice. Report them to the server once it has a route for flagging
 * duplicates, rather than only hiding the repeat here.
 */
export function fileLines(profiles: readonly CatalogueMediaProfile[]): string[] {
  return [...new Set(profiles.map(mediaProfileSummary))];
}
