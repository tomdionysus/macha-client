import type { CatalogueMediaProfile, CatalogueStatus } from './CatalogueApi';
import type { ArtworkRef, LibraryHome, MediaDetails, MediaSummary } from '../types';

/** UI-facing catalogue facade. It contains no playback or per-client state. */
export interface MediaApi {
  status(): Promise<CatalogueStatus>;
  home(): Promise<LibraryHome>;
  movies(): Promise<MediaSummary[]>;
  shows(): Promise<MediaSummary[]>;
  artists(): Promise<MediaSummary[]>;
  albums(): Promise<MediaSummary[]>;
  tracks(): Promise<MediaSummary[]>;
  details(id: string): Promise<MediaDetails>;
  search(query: string): Promise<MediaSummary[]>;
  artwork(ref: ArtworkRef, signal?: AbortSignal): Promise<Blob>;
  invalidateArtwork?(ref: ArtworkRef): void;
  mediaProfile?(mediaId: string, signal?: AbortSignal): Promise<CatalogueMediaProfile | undefined>;
}
