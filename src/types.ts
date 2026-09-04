import type { CatalogueKind } from './api/CatalogueApi';

export type MediaKind = CatalogueKind;

export interface ArtworkRef {
  id: string;
  mimeType: string;
  /** Short-lived signed capability URL, when the server supplies one. Renders directly with no client-side fetch/cache. */
  url?: string;
}

export interface Artwork {
  poster?: ArtworkRef;
  backdrop?: ArtworkRef;
  thumbnail?: ArtworkRef;
}

export interface PlaybackHierarchyContext {
  series: { id: string; title: string };
  season: { id: string; title: string; seasonNumber: number };
}

export interface MediaSummary {
  id: string;
  kind: MediaKind;
  title: string;
  subtitle?: string;
  year?: number;
  synopsis?: string;
  artwork?: Artwork;
  parentId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  discNumber?: number;
  trackNumber?: number;
  mediaIds: string[];
  durationMs?: number;
  playbackContext?: PlaybackHierarchyContext;

  /** Catalogue `updated_ns`, currently the server's only chronology signal for Home recency ordering. */
  catalogueUpdatedNs?: number;

  /**
   * Reserved UI field for a future catalogue release/air date.
   * The current Macha catalogue wire model does not expose this yet.
   */
  releaseDate?: string;
}

export interface Episode extends MediaSummary {
  kind: 'episode';
  seasonNumber: number;
  episodeNumber: number;
}

export interface SeasonSummary extends MediaSummary {
  kind: 'season';
  showId: string;
  seasonNumber: number;
}

export interface SeasonDetails extends SeasonSummary {
  episodes: Episode[];
}

export interface ShowDetails extends MediaSummary {
  kind: 'show';
  seasons: SeasonSummary[];
}

export interface ArtistDetails extends MediaSummary {
  kind: 'artist';
  albums: MediaSummary[];
}

export interface AlbumDetails extends MediaSummary {
  kind: 'album';
  tracks: MediaSummary[];
}

export interface MovieDetails extends MediaSummary {
  kind: 'movie';
}

export type MediaDetails = ShowDetails | SeasonDetails | ArtistDetails | AlbumDetails | MediaSummary;

export interface LibraryHome {
  movies: MediaSummary[];
  shows: MediaSummary[];
  albums: MediaSummary[];
}

export interface PlaybackProgress {
  mediaId: string;
  positionMs: number;
  durationMs: number;
  updatedAt: number;
  media?: MediaSummary;
}

export type VideoCodec = 'h264' | 'hevc' | 'vp9' | 'av1' | 'mpeg2' | string;
export type AudioCodec = 'aac' | 'ac3' | 'eac3' | 'opus' | 'mp3' | 'flac' | string;

export interface PlaybackCapabilities {
  platform: 'web' | 'android' | 'tizen';
  /** Optional decoder/platform limits. Web deliberately leaves these unset. */
  maxWidth?: number;
  maxHeight?: number;
  videoCodecs: VideoCodec[];
  audioCodecs: AudioCodec[];
  containers: string[];
  hls: boolean;
  dash: boolean;
  hdr: string[];
}

export interface MediaTechnicalStream {
  index: number;
  type: 'video' | 'audio' | 'subtitle' | 'other';
  codec: string;
  profile: string;
  language: string;
  width?: number;
  height?: number;
  channels?: number;
  sampleRate?: number;
  bitDepth?: number;
  bitrate?: number;
  default: boolean;
  forced: boolean;
}

/**
 * Source facts used for opportunistic local player preparation. They may come
 * from an immutable catalogue profile or from the authoritative session
 * response; consumers must never wait for the catalogue form.
 */
export interface MediaTechnicalProfile {
  mediaId: string;
  format: string;
  durationMs: number;
  bitrate: number;
  sizeBytes?: number;
  streams: MediaTechnicalStream[];
  negotiated?: {
    mode: PlaybackMode;
    mimeType: string;
    format?: string;
  };
}

export type PlaybackMode = 'direct' | 'remux' | 'transcode';

export interface PlaybackSource {
  mediaId: string;
  url: string;
  subtitleUrl?: string;
  mimeType?: string;
  mode: PlaybackMode;
  durationMs?: number;
  /** Source byte length when known; enables bounded Direct Play read-ahead. */
  sizeBytes?: number;
  headers?: Record<string, string>;
}

export interface PlaybackTimeRange {
  startMs: number;
  endMs: number;
}

export interface PlaybackEvent {
  positionMs: number;
  durationMs: number;
  paused: boolean;
  ended: boolean;
  /** True while the underlying media element is resolving a new seek position. */
  seeking?: boolean;
  /** True while playback wants to run but lacks enough media to continue. */
  buffering?: boolean;
  /** Buffered media-time ranges reported by the active player. */
  bufferedRangesMs?: PlaybackTimeRange[];
  /** Contiguous buffered runway ahead of the current media position. */
  forwardBufferMs?: number;
  /** Query/credential-free origin currently serving media bytes. */
  streamOrigin?: string;
}
