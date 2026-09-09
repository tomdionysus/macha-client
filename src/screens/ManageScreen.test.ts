import { describe, expect, it, vi } from 'vitest';
import { candidateAlreadyCatalogued, pageSlice, pathBreadcrumbs, runBulkOperation } from './ManageScreen';
import type { ManageCatalogueMatch, MediaProbeCandidate } from '@macha/core';

function probe(overrides: Partial<MediaProbeCandidate> = {}): MediaProbeCandidate {
  return {
    kind: 'movie', score: 90, generator: 'filename', title: 'Jurassic Park', year: 1993,
    series: '', season_number: null, episode_number: null,
    artist: '', album: '', disc_number: null, track_number: null, evidence: [],
    ...overrides,
  };
}

function catalogued(overrides: Partial<ManageCatalogueMatch> = {}): ManageCatalogueMatch {
  return {
    id: 'tmdb:movie:329', kind: 'movie', title: 'Jurassic Park', sort_title: 'jurassic park',
    synopsis: '', parent_id: null, year: 1993,
    season_number: null, episode_number: null, disc_number: null, track_number: null,
    media_ids: [], revision: 1, updated_ns: 0,
    ...overrides,
  };
}

describe('candidates the catalogue already has', () => {
  it('drops an inferred candidate that is already an offered match, punctuation and case aside', () => {
    // The same identity appearing twice — once with a working "Use match"
    // button and once without — is what made the inferred list dead weight.
    expect(candidateAlreadyCatalogued(probe({ title: 'jurassic park!' }), [catalogued()])).toBe(true);
  });

  it('keeps a candidate the catalogue genuinely does not have, which is the only useful kind', () => {
    expect(candidateAlreadyCatalogued(probe({ title: 'The Lost World' }), [catalogued()])).toBe(false);
    expect(candidateAlreadyCatalogued(probe({ year: 2015 }), [catalogued()])).toBe(false);
    expect(candidateAlreadyCatalogued(probe(), [])).toBe(false);
  });

  it('never lets a field only one side states rule a candidate out', () => {
    // A match with no year is not evidence that the year differs, and hiding
    // on a difference neither side claimed loses the reader a real option.
    expect(candidateAlreadyCatalogued(probe({ year: 1993 }), [catalogued({ year: null })])).toBe(true);
    expect(candidateAlreadyCatalogued(probe({ year: null }), [catalogued({ year: 1993 })])).toBe(true);
  });

  it('separates episodes of the same name by their position', () => {
    const episode = probe({ kind: 'episode', title: 'Pilot', year: null, series: 'Lost', season_number: 1, episode_number: 1 });
    const listed = catalogued({ kind: 'episode', title: 'Pilot', year: null, season_number: 1, episode_number: 2 });
    expect(candidateAlreadyCatalogued(episode, [listed])).toBe(false);
    expect(candidateAlreadyCatalogued(episode, [{ ...listed, episode_number: 1 }])).toBe(true);
  });

  it('does not match a candidate with no title at all', () => {
    expect(candidateAlreadyCatalogued(probe({ title: '   ' }), [catalogued({ title: '' })])).toBe(false);
  });
});

describe('ManageScreen helpers', () => {
  it('builds clickable cumulative MachaDFS path segments', () => {
    expect(pathBreadcrumbs('/Movies/Science Fiction')).toEqual([
      { label: 'MachaDFS', path: '/' },
      { label: 'Movies', path: '/Movies' },
      { label: 'Science Fiction', path: '/Movies/Science Fiction' },
    ]);
  });

  it('runs every selected operation and reports partial failures', async () => {
    const operation = vi.fn(async (id: string) => {
      if (id === 'broken') throw new Error('unavailable');
    });

    await expect(runBulkOperation(['one', 'broken', 'three'], operation)).resolves.toBe(1);
    expect(operation.mock.calls.map(([id]) => id)).toEqual(['one', 'broken', 'three']);
  });

  it('bounds list pages and slices without dropping the final partial page', () => {
    const items = Array.from({ length: 43 }, (_, index) => index);
    expect(pageSlice(items, 0).items).toEqual(items.slice(0, 20));
    expect(pageSlice(items, 2)).toEqual({ items: [40, 41, 42], page: 2, pageCount: 3 });
    expect(pageSlice(items, 99).page).toBe(2);
    expect(pageSlice([], 4)).toEqual({ items: [], page: 0, pageCount: 1 });
  });
});
