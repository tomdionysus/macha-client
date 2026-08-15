import type { CatalogueKind } from './api/CatalogueApi';

export type MediaKind = CatalogueKind;

export interface ArtworkRef {
  id: string;
  mimeType: string;
}

export interface Artwork {
  poster?: ArtworkRef;
  backdrop?: ArtworkRef;
  thumbnail?: ArtworkRef;
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
  maxWidth: number;
  maxHeight: number;
  videoCodecs: VideoCodec[];
  audioCodecs: AudioCodec[];
  containers: string[];
  hls: boolean;
  dash: boolean;
  hdr: string[];
}

export type PlaybackMode = 'direct' | 'remux' | 'transcode';

export interface PlaybackSource {
  mediaId: string;
  url: string;
  subtitleUrl?: string;
  mimeType?: string;
  mode: PlaybackMode;
  durationMs?: number;
  headers?: Record<string, string>;
}

export interface PlaybackEvent {
  positionMs: number;
  durationMs: number;
  paused: boolean;
  ended: boolean;
}
