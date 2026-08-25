import type { MediaApi } from './MediaApi';
import type { CatalogueStatus } from './CatalogueApi';
import type {
  AlbumDetails,
  ArtistDetails,
  ArtworkRef,
  LibraryHome,
  MediaDetails,
  MediaSummary,
  SeasonDetails,
  SeasonSummary,
  ShowDetails,
} from '../types';

const movies: MediaSummary[] = [
  {
    id: 'movie-alien',
    kind: 'movie',
    title: 'Alien',
    year: 1979,
    synopsis: 'A commercial starship crew encounters something lethal.',
    durationMs: 7_020_000,
    mediaIds: ['demo:alien'],
  },
  {
    id: 'movie-moon',
    kind: 'movie',
    title: 'Moon',
    year: 2009,
    synopsis: 'A lunar worker approaches the end of an isolated contract.',
    durationMs: 5_820_000,
    mediaIds: ['demo:moon'],
  },
];

const seasonSummary: SeasonSummary = {
  id: 'red-dwarf-s1',
  kind: 'season',
  showId: 'show-red-dwarf',
  parentId: 'show-red-dwarf',
  seasonNumber: 1,
  title: 'Season 1',
  mediaIds: [],
};

const season: SeasonDetails = {
  ...seasonSummary,
  episodes: [1, 2, 3, 4, 5, 6].map((episodeNumber) => ({
    id: `red-dwarf-s1e${episodeNumber}`,
    kind: 'episode' as const,
    parentId: seasonSummary.id,
    seasonNumber: 1,
    episodeNumber,
    title: `Episode ${episodeNumber}`,
    subtitle: `S01E${String(episodeNumber).padStart(2, '0')}`,
    synopsis: `Demo synopsis for episode ${episodeNumber}.`,
    releaseDate: episodeNumber <= 3 ? `1988-02-${14 + episodeNumber}` : undefined,
    durationMs: 1_740_000,
    mediaIds: [`demo:red-dwarf:1:${episodeNumber}`],
  })),
};

const show: ShowDetails = {
  id: 'show-red-dwarf',
  kind: 'show',
  title: 'Red Dwarf',
  year: 1988,
  synopsis: 'Three million years from Earth, the last human alive has company.',
  mediaIds: [],
  seasons: [seasonSummary],
};

const artistSummary: MediaSummary = {
  id: 'artist-bowie',
  kind: 'artist',
  title: 'David Bowie',
  mediaIds: [],
};

const albumSummary: MediaSummary = {
  id: 'album-low',
  kind: 'album',
  parentId: artistSummary.id,
  title: 'Low',
  year: 1977,
  mediaIds: [],
};

const album: AlbumDetails = {
  ...albumSummary,
  kind: 'album',
  tracks: [
    ['Speed of Life', 1, 166_000],
    ['Breaking Glass', 2, 112_000],
    ['What in the World', 3, 141_000],
    ['Sound and Vision', 4, 183_000],
    ['Always Crashing in the Same Car', 5, 213_000],
  ].map(([title, trackNumber, durationMs]) => ({
    id: `low-track-${trackNumber}`,
    kind: 'track' as const,
    parentId: albumSummary.id,
    title: String(title),
    trackNumber: Number(trackNumber),
    subtitle: `Track ${trackNumber}`,
    durationMs: Number(durationMs),
    mediaIds: [`demo:low:${trackNumber}`],
  })),
};

const artist: ArtistDetails = {
  ...artistSummary,
  kind: 'artist',
  albums: [albumSummary],
};

const shows: MediaSummary[] = [show];
const artists: MediaSummary[] = [artistSummary];
const albums: MediaSummary[] = [albumSummary];
const all: MediaSummary[] = [
  ...movies,
  ...shows,
  seasonSummary,
  ...season.episodes,
  ...artists,
  ...albums,
  ...album.tracks,
];

const status: CatalogueStatus = {
  enabled: true,
  ready: true,
  metadata_generation: 1,
  root: 'demo',
  items: all.length,
  artwork_objects: 0,
  local_artwork_objects: 0,
  last_sync_unix_ms: Date.now(),
  error: null,
};

export class MockMediaApi implements MediaApi {
  async status(): Promise<CatalogueStatus> {
    return status;
  }

  async home(): Promise<LibraryHome> {
    return { movies, shows, albums };
  }

  async movies(): Promise<MediaSummary[]> {
    return movies;
  }

  async shows(): Promise<MediaSummary[]> {
    return shows;
  }

  async artists(): Promise<MediaSummary[]> {
    return artists;
  }

  async albums(): Promise<MediaSummary[]> {
    return albums;
  }

  async tracks(): Promise<MediaSummary[]> {
    return album.tracks;
  }

  async details(id: string): Promise<MediaDetails> {
    if (id === show.id) return show;
    if (id === season.id) return season;
    if (id === artist.id) return artist;
    if (id === album.id) return album;
    const result = all.find((item) => item.id === id);
    if (!result) throw new Error(`Unknown media item: ${id}`);
    return result;
  }

  async artwork(_ref: ArtworkRef, _signal?: AbortSignal): Promise<Blob> {
    throw new Error('Demo catalogue has no artwork objects');
  }

  async search(query: string): Promise<MediaSummary[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return all.filter((item) => `${item.title} ${item.subtitle ?? ''}`.toLowerCase().includes(q));
  }
}
