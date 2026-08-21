import { describe, expect, it } from 'vitest';
import type { CatalogueApi, CatalogueItem, CatalogueKind, CatalogueStatus } from './CatalogueApi';
import { MachaMediaApi } from './MachaMediaApi';

function catalogueItem(id: string, kind: CatalogueKind, partial: Partial<CatalogueItem> = {}): CatalogueItem {
  return {
    id,
    kind,
    title: id,
    sort_title: id,
    synopsis: '',
    parent_id: null,
    year: null,
    season_number: null,
    episode_number: null,
    disc_number: null,
    track_number: null,
    aliases: [],
    external_ids: {},
    media_ids: [],
    artwork: [],
    revision: 1,
    updated_ns: 0,
    ...partial,
  };
}

class FakeCatalogue implements CatalogueApi {
  status(): Promise<CatalogueStatus> { throw new Error('not used'); }
  update(item: CatalogueItem): Promise<CatalogueItem> { return Promise.resolve(item); }
  clearMetadata(): Promise<void> { return Promise.resolve(); }
  artwork(id: string): Promise<Blob> { return Promise.resolve(new Blob([id])); }
  search(): Promise<CatalogueItem[]> { return Promise.resolve([]); }
  get(id: string): Promise<CatalogueItem> {
    if (id === 'show') return Promise.resolve(catalogueItem('show', 'show', { title: 'Show' }));
    if (id === 'season-1') return Promise.resolve(catalogueItem('season-1', 'season', {
      parent_id: 'show',
      season_number: 1,
      title: 'Season 1',
      artwork: [{ role: 'poster', id: 'season-art', mime_type: 'image/jpeg' }],
    }));
    if (id === 'artist-1') return Promise.resolve(catalogueItem('artist-1', 'artist', { title: 'Artist' }));
    if (id === 'album-1') return Promise.resolve(catalogueItem('album-1', 'album', { parent_id: 'artist-1', title: 'Album' }));
    throw new Error('not found');
  }
  list(kind?: CatalogueKind, parent?: string): Promise<CatalogueItem[]> {
    if (kind === 'season' && parent === 'show') {
      return Promise.resolve([catalogueItem('season-1', 'season', {
        parent_id: 'show',
        season_number: 1,
        title: 'Season 1',
        artwork: [{ role: 'poster', id: 'season-art', mime_type: 'image/jpeg' }],
      })]);
    }
    if (kind === 'episode' && parent === 'season-1') {
      return Promise.resolve([catalogueItem('episode-1', 'episode', {
        parent_id: 'season-1',
        season_number: 1,
        episode_number: 2,
        title: 'Episode',
        media_ids: ['file:abc'],
        artwork: [{ role: 'still', id: 'art123', mime_type: 'image/jpeg' }],
      })]);
    }
    if (kind === 'album' && parent === 'artist-1') {
      return Promise.resolve([catalogueItem('album-1', 'album', { parent_id: 'artist-1', title: 'Album', year: 1999 })]);
    }
    if (kind === 'track' && parent === 'album-1') {
      return Promise.resolve([
        catalogueItem('track-2', 'track', { parent_id: 'album-1', disc_number: 1, track_number: 2, title: 'Second', media_ids: ['file:2'] }),
        catalogueItem('track-1', 'track', { parent_id: 'album-1', disc_number: 1, track_number: 1, title: 'First', media_ids: ['file:1'] }),
      ]);
    }
    return Promise.resolve([]);
  }
}

describe('MachaMediaApi', () => {
  it('loads only season summaries for a series detail page', async () => {
    const api = new MachaMediaApi(new FakeCatalogue());
    const details = await api.details('show');
    expect(details.kind).toBe('show');
    if (details.kind !== 'show' || !('seasons' in details)) throw new Error('expected show details');
    expect(details.seasons[0]).toEqual(expect.objectContaining({
      id: 'season-1',
      showId: 'show',
      seasonNumber: 1,
      artwork: { poster: { id: 'season-art', mimeType: 'image/jpeg' } },
    }));
    expect('episodes' in details.seasons[0]).toBe(false);
  });

  it('loads episode details only when the season page is opened', async () => {
    const api = new MachaMediaApi(new FakeCatalogue());
    const details = await api.details('season-1');
    expect(details.kind).toBe('season');
    if (details.kind !== 'season' || !('episodes' in details)) throw new Error('expected season details');
    expect(details.episodes[0]).toEqual(expect.objectContaining({
      id: 'episode-1',
      subtitle: 'S01E02',
      mediaIds: ['file:abc'],
      artwork: { thumbnail: { id: 'art123', mimeType: 'image/jpeg' } },
      releaseDate: undefined,
    }));
  });

  it('maps artist, album and track hierarchy for the Music client', async () => {
    const api = new MachaMediaApi(new FakeCatalogue());
    const artist = await api.details('artist-1');
    expect(artist.kind).toBe('artist');
    if (artist.kind !== 'artist' || !('albums' in artist)) throw new Error('expected artist details');
    expect(artist.albums.map((item) => item.id)).toEqual(['album-1']);

    const album = await api.details('album-1');
    expect(album.kind).toBe('album');
    if (album.kind !== 'album' || !('tracks' in album)) throw new Error('expected album details');
    expect(album.tracks.map((item) => item.id)).toEqual(['track-1', 'track-2']);
    expect(album.tracks[0].subtitle).toBe('Track 1');
  });

});
