import { describe, expect, it, vi } from 'vitest';
import type { ManageApi, MediaProbeCandidate } from '@machafoundation/core';
import { applyCandidatePicture, findCandidatePictures, pictureLookup, sameTitle, type CandidatePicture } from './candidatePicture';

const probe = (overrides: Partial<MediaProbeCandidate>): MediaProbeCandidate => ({
  kind: 'track', score: 80, generator: 'tags', title: 'A Song', year: null, series: '', season_number: null, episode_number: null,
  artist: 'A Band', album: 'A Record', disc_number: null, track_number: 1, evidence: [], ...overrides,
} as MediaProbeCandidate);

const option = { option_id: 'o1', role: 'cover', width: 250, height: 250, language: null, preview_url: 'https://provider/o1.jpg' };

describe('a candidate\'s picture', () => {
  it('asks for what the candidate names: a movie\'s poster, an episode\'s still, a track\'s album cover', () => {
    expect(pictureLookup(probe({ kind: 'movie', title: 'A Film', year: 2001 }))).toMatchObject({ query: 'A Film', searchKind: 'movie', role: 'poster', year: 2001 });
    expect(pictureLookup(probe({ kind: 'episode', series: 'A Series', season_number: 1, episode_number: 2 })))
      .toMatchObject({ query: 'A Series', searchKind: 'show', role: 'still', season_number: 1, episode_number: 2 });
    expect(pictureLookup(probe({}))).toMatchObject({ query: 'A Record', searchKind: 'album', role: 'cover', artist: 'A Band' });
    expect(pictureLookup(probe({ album: '' }))).toBeUndefined();
    expect(pictureLookup(probe({ kind: 'episode', series: 'A Series', season_number: 1, episode_number: null }))).toBeUndefined();
  });

  it('takes the provider\'s first result only when its title is the one named', () => {
    expect(sameTitle('A Record', 'A Record (Deluxe Edition)')).toBe(true);
    expect(sameTitle('Unknown Album', 'A Record')).toBe(false);
  });

  it('takes the first result by the candidate\'s artist, which the provider\'s exact artist filter would have missed', async () => {
    const manage = {
      providerSearch: vi.fn(async () => [
        { ref: 'musicbrainz:release:other', provider: 'musicbrainz', kind: 'album', title: 'A Record', artist: 'Another Band', year: 1995 },
        { ref: 'musicbrainz:release:r1', provider: 'musicbrainz', kind: 'album', title: 'A Record', artist: 'Band', year: 2007 },
      ]),
      providerArtwork: vi.fn(async () => [option]),
    } as unknown as ManageApi;
    const [found] = await Promise.all(findCandidatePictures(manage, [probe({ artist: 'DJ Band' })]));
    expect(manage.providerSearch).toHaveBeenCalledWith('A Record', 'album', { year: undefined, limit: 5 });
    expect(found?.ref).toBe('musicbrainz:release:r1');
  });

  it('tries the next release when the first has no cover', async () => {
    const manage = {
      providerSearch: vi.fn(async () => [
        { ref: 'musicbrainz:release:bare', provider: 'musicbrainz', kind: 'album', title: 'A Record', artist: 'A Band', year: 2007 },
        { ref: 'musicbrainz:release:r1', provider: 'musicbrainz', kind: 'album', title: 'A Record', artist: 'A Band', year: 2007 },
      ]),
      providerArtwork: vi.fn(async (ref: string) => (ref.endsWith('bare') ? [] : [option])),
    } as unknown as ManageApi;
    const [found] = await Promise.all(findCandidatePictures(manage, [probe({})]));
    expect(found?.ref).toBe('musicbrainz:release:r1');
  });

  it('asks the provider once for candidates naming the same album, and nothing for one whose result is another title', async () => {
    const manage = {
      providerSearch: vi.fn(async (query: string) => [{ ref: 'musicbrainz:release:r1', provider: 'musicbrainz', kind: 'album', title: query === 'A Record' ? 'A Record' : 'Something Else', year: null }]),
      providerArtwork: vi.fn(async () => [option]),
    } as unknown as ManageApi;
    const found = await Promise.all(findCandidatePictures(manage, [probe({}), probe({ generator: 'path' }), probe({ album: 'Elsewhere' })]));
    expect(manage.providerSearch).toHaveBeenCalledTimes(2);
    expect(manage.providerArtwork).toHaveBeenCalledTimes(1);
    expect(found.map((picture) => picture?.option.option_id)).toEqual(['o1', 'o1', undefined]);
  });

  it('puts a cover on the album the entry wrote and a poster on the item, naming the record', async () => {
    const manage = { chooseArtwork: vi.fn(async () => ({})) } as unknown as ManageApi;
    const written = { leaf_item_id: 'manual:track:1', items: [{ id: 'manual:track:1', kind: 'track' }, { id: 'manual:album:1', kind: 'album' }] } as never;
    const cover: CandidatePicture = { kind: 'track', ref: 'musicbrainz:release:r1', role: 'cover', option: option as never };
    await applyCandidatePicture(manage, cover, written);
    expect(manage.chooseArtwork).toHaveBeenCalledWith('manual:album:1', 'cover', 'o1', { ref: 'musicbrainz:release:r1', season_number: undefined, episode_number: undefined });
    await applyCandidatePicture(manage, { ...cover, kind: 'movie', role: 'poster', ref: 'tmdb:movie:1' }, written);
    expect(manage.chooseArtwork).toHaveBeenLastCalledWith('manual:track:1', 'poster', 'o1', expect.objectContaining({ ref: 'tmdb:movie:1' }));
  });
});
