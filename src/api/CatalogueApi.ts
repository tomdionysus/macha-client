export type CatalogueKind =
  | 'movie'
  | 'show'
  | 'season'
  | 'episode'
  | 'artist'
  | 'album'
  | 'track';

export interface CatalogueArtwork {
  role: string;
  id: string;
  mime_type: string;
}

/** Exact JSON shape exposed by Macha's catalogue API. */
export interface CatalogueItem {
  id: string;
  kind: CatalogueKind;
  title: string;
  sort_title: string;
  synopsis: string;
  parent_id: string | null;
  year: number | null;
  season_number: number | null;
  episode_number: number | null;
  disc_number: number | null;
  track_number: number | null;
  aliases: string[];
  external_ids: Record<string, string>;
  media_ids: string[];
  artwork: CatalogueArtwork[];
  revision: number;
  updated_ns: number;
}

export interface CatalogueStatus {
  enabled: boolean;
  ready: boolean;
  metadata_generation: number;
  root: string | null;
  items: number;
  artwork_objects: number;
  local_artwork_objects: number;
  last_sync_unix_ms: number;
  error: string | null;
}

export interface CatalogueApi {
  status(): Promise<CatalogueStatus>;
  list(kind?: CatalogueKind, parent?: string): Promise<CatalogueItem[]>;
  get(id: string): Promise<CatalogueItem>;
  search(query: string, limit?: number): Promise<CatalogueItem[]>;
  artwork(id: string): Promise<Blob>;
}
