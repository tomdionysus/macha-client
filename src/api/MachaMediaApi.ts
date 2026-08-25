import type { CatalogueApi, CatalogueArtwork, CatalogueItem } from './CatalogueApi';
import type { MediaApi } from './MediaApi';
import type {
  AlbumDetails,
  ArtistDetails,
  Artwork,
  ArtworkRef,
  Episode,
  LibraryHome,
  MediaDetails,
  MediaSummary,
  SeasonDetails,
  SeasonSummary,
  ShowDetails,
} from '../types';

function optionalNumber(value: number | null): number | undefined {
  return value ?? undefined;
}

export class MachaMediaApi implements MediaApi {
  private readonly artworkCache = new Map<string, Blob>();
  private readonly artworkRequests = new Map<string, Promise<Blob>>();

  constructor(private readonly catalogue: CatalogueApi) {}

  status() {
    return this.catalogue.status();
  }

  async home(): Promise<LibraryHome> {
    const [movies, shows, albums] = await Promise.all([this.movies(), this.shows(), this.albums()]);
    return { movies, shows, albums };
  }

  async movies(): Promise<MediaSummary[]> {
    return (await this.catalogue.list('movie')).map((item) => this.media(item));
  }

  async shows(): Promise<MediaSummary[]> {
    return (await this.catalogue.list('show')).map((item) => this.media(item));
  }

  async artists(): Promise<MediaSummary[]> {
    return (await this.catalogue.list('artist')).map((item) => this.media(item));
  }

  async albums(): Promise<MediaSummary[]> {
    return (await this.catalogue.list('album')).map((item) => this.media(item));
  }

  async tracks(): Promise<MediaSummary[]> {
    return (await this.catalogue.list('track')).map((item) => this.media(item));
  }

  async details(id: string): Promise<MediaDetails> {
    const item = await this.catalogue.get(id);

    if (item.kind === 'show') {
      const seasonItems = await this.catalogue.list('season', item.id);
      const seasons = seasonItems
        .map((seasonItem) => this.seasonSummary(seasonItem, item.id))
        .sort((a, b) => a.seasonNumber - b.seasonNumber);
      return {
        ...this.media(item),
        kind: 'show',
        seasons,
      } as ShowDetails;
    }

    if (item.kind === 'season') {
      const episodeItems = await this.catalogue.list('episode', item.id);
      const seasonNumber = item.season_number ?? 0;
      const episodes = episodeItems
        .map((episode): Episode => ({
          ...this.media(episode),
          kind: 'episode',
          seasonNumber: episode.season_number ?? seasonNumber,
          episodeNumber: episode.episode_number ?? 0,
        }))
        .sort((a, b) => a.episodeNumber - b.episodeNumber);
      return {
        ...this.seasonSummary(item, item.parent_id ?? ''),
        episodes,
      } as SeasonDetails;
    }

    if (item.kind === 'artist') {
      const albums = (await this.catalogue.list('album', item.id))
        .map((album) => this.media(album))
        .sort((a, b) => (a.year ?? Number.MAX_SAFE_INTEGER) - (b.year ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title));
      return {
        ...this.media(item),
        kind: 'artist',
        albums,
      } as ArtistDetails;
    }

    if (item.kind === 'album') {
      const tracks = (await this.catalogue.list('track', item.id))
        .map((track) => this.media(track))
        .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
      return {
        ...this.media(item),
        kind: 'album',
        tracks,
      } as AlbumDetails;
    }

    return this.media(item);
  }

  async search(query: string): Promise<MediaSummary[]> {
    return (await this.catalogue.search(query, 50)).map((item) => this.media(item));
  }

  artwork(ref: ArtworkRef, signal?: AbortSignal): Promise<Blob> {
    const cached = this.artworkCache.get(ref.id);
    if (cached) return Promise.resolve(cached);

    // Abortable artwork requests are used by viewport-driven lazy loading. They
    // must not share an in-flight request with unrelated consumers: when the
    // card scrolls away its request needs to be genuinely cancellable without
    // aborting somebody else's detail/backdrop fetch. LazyArtwork already
    // coalesces duplicate artwork IDs in its request scheduler.
    if (signal) {
      return this.catalogue.artwork(ref.id, signal).then((blob) => {
        this.artworkCache.set(ref.id, blob);
        return blob;
      });
    }

    let pending = this.artworkRequests.get(ref.id);
    if (!pending) {
      pending = this.catalogue.artwork(ref.id).then((blob) => {
        this.artworkCache.set(ref.id, blob);
        this.artworkRequests.delete(ref.id);
        return blob;
      }, (error) => {
        this.artworkRequests.delete(ref.id);
        throw error;
      });
      this.artworkRequests.set(ref.id, pending);
    }
    return pending;
  }

  private seasonSummary(item: CatalogueItem, showId: string): SeasonSummary {
    const media = this.media(item);
    const seasonNumber = item.season_number ?? 0;
    return {
      ...media,
      kind: 'season',
      showId,
      seasonNumber,
      title: item.title || `Season ${seasonNumber}`,
    };
  }

  private media(item: CatalogueItem): MediaSummary {
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      subtitle: this.subtitle(item),
      year: optionalNumber(item.year),
      synopsis: item.synopsis || undefined,
      artwork: this.mapArtwork(item.artwork),
      parentId: item.parent_id ?? undefined,
      seasonNumber: optionalNumber(item.season_number),
      episodeNumber: optionalNumber(item.episode_number),
      discNumber: optionalNumber(item.disc_number),
      trackNumber: optionalNumber(item.track_number),
      mediaIds: [...item.media_ids],
      catalogueUpdatedNs: item.updated_ns,
      // Placeholder until Macha exposes a full date from the metadata provider.
      releaseDate: undefined,
    };
  }

  private mapArtwork(items: CatalogueArtwork[]): Artwork | undefined {
    if (items.length === 0) return undefined;
    const byRole = (roles: string[]): ArtworkRef | undefined => {
      const item = items.find((candidate) => roles.includes(candidate.role));
      return item ? { id: item.id, mimeType: item.mime_type } : undefined;
    };
    const result: Artwork = {
      poster: byRole(['poster', 'cover']),
      backdrop: byRole(['backdrop', 'background', 'fanart']),
      thumbnail: byRole(['still', 'thumbnail', 'thumb']),
    };
    return result.poster || result.backdrop || result.thumbnail ? result : undefined;
  }

  private subtitle(item: CatalogueItem): string | undefined {
    if (item.kind === 'episode' && item.episode_number !== null) {
      const episode = String(item.episode_number).padStart(2, '0');
      if (item.season_number !== null) return `S${String(item.season_number).padStart(2, '0')}E${episode}`;
      return `Episode ${item.episode_number}`;
    }
    if (item.kind === 'season' && item.season_number !== null) return `Season ${item.season_number}`;
    if (item.kind === 'track' && item.track_number !== null) {
      return item.disc_number && item.disc_number > 1
        ? `Disc ${item.disc_number} · Track ${item.track_number}`
        : `Track ${item.track_number}`;
    }
    return undefined;
  }
}
