import { describe, expect, it, vi } from 'vitest';
import { endpointFailure, MachaConnectionError, MachaRequestTimeoutError } from '@machafoundation/core';
import { browserOrder, deleteInTurn, deleteOutcomeText, pathBreadcrumbs, sortUnmatched } from './ManageScreen';
import { candidateAlreadyCatalogued } from './identify/UnmatchedFilePage';
import { runBulkOperation } from '../components/ListParts';
import type { MachaDfsEntry, ManageCatalogueMatch, MediaProbeCandidate, UnmatchedFile } from '@machafoundation/core';

function probe(overrides: Partial<MediaProbeCandidate> = {}): MediaProbeCandidate {
  return {
    kind: 'movie', score: 90, generator: 'filename', title: 'Example Film', year: 1993,
    series: '', season_number: null, episode_number: null,
    artist: '', album: '', disc_number: null, track_number: null, evidence: [],
    ...overrides,
  };
}

function catalogued(overrides: Partial<ManageCatalogueMatch> = {}): ManageCatalogueMatch {
  return {
    id: 'tmdb:movie:900001', kind: 'movie', title: 'Example Film', sort_title: 'example film',
    synopsis: '', parent_id: null, year: 1993,
    season_number: null, episode_number: null, disc_number: null, track_number: null,
    media_ids: [], revision: 1, updated_ns: 0,
    ...overrides,
  };
}

describe('candidates the catalogue already has', () => {
  it('drops an inferred candidate that is already an offered match, punctuation and case aside', () => {
    // Else the same identity appears twice, only once with a working "Use match" button.
    expect(candidateAlreadyCatalogued(probe({ title: 'example film!' }), [catalogued()])).toBe(true);
  });

  it('keeps a candidate the catalogue genuinely does not have, which is the only useful kind', () => {
    expect(candidateAlreadyCatalogued(probe({ title: 'Example Film Two' }), [catalogued()])).toBe(false);
    expect(candidateAlreadyCatalogued(probe({ year: 2015 }), [catalogued()])).toBe(false);
    expect(candidateAlreadyCatalogued(probe(), [])).toBe(false);
  });

  it('never lets a field only one side states rule a candidate out', () => {
    // A missing year is not evidence that the year differs.
    expect(candidateAlreadyCatalogued(probe({ year: 1993 }), [catalogued({ year: null })])).toBe(true);
    expect(candidateAlreadyCatalogued(probe({ year: null }), [catalogued({ year: 1993 })])).toBe(true);
  });

  it('separates episodes of the same name by their position', () => {
    const episode = probe({ kind: 'episode', title: 'Pilot', year: null, series: 'The Show', season_number: 1, episode_number: 1 });
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

});

describe('the unmatched list order', () => {
  const file = (id: string, path: string, overrides: Partial<UnmatchedFile> = {}): UnmatchedFile => ({
    id, path, provider: null, media_id: null, result: 'no_match', attempts: 1, updated_unix_ms: 1_000, size: 100, mtime_ns: 0, current: true, ...overrides,
  });
  const files = [
    file('a', '/Movies/b.mkv', { updated_unix_ms: 3_000, size: 10, attempts: 2 }),
    file('b', '/Movies/a.mkv', { updated_unix_ms: 1_000, size: 30, attempts: 5 }),
    file('c', '/Shows/c.mkv', { updated_unix_ms: 2_000, size: 20, attempts: 1 }),
  ];
  const ids = (sorted: UnmatchedFile[]) => sorted.map((entry) => entry.id);

  it('shows the most recent attempt first until asked otherwise', () => {
    expect(ids(sortUnmatched(files, { key: 'updated', direction: 'desc' }))).toEqual(['a', 'c', 'b']);
  });

  it('sorts by file name, not by the folder it sits in', () => {
    expect(ids(sortUnmatched(files, { key: 'name', direction: 'asc' }))).toEqual(['b', 'a', 'c']);
  });

  it('sorts by size and attempts, largest first', () => {
    expect(ids(sortUnmatched(files, { key: 'size', direction: 'desc' }))).toEqual(['b', 'c', 'a']);
    expect(ids(sortUnmatched(files, { key: 'attempts', direction: 'desc' }))).toEqual(['b', 'a', 'c']);
  });
});

describe('deleting unmatched files', () => {
  const gone = Object.assign(new Error('log'), { status: 404 });
  const stale = Object.assign(new Error('log'), { status: 409, detail: 'The file there has changed.' });
  const timedOut = endpointFailure('fi-1', 'http://fi-1', new MachaRequestTimeoutError('exceeded 30000 ms', 30_000));

  it('sends one delete at a time, never a burst', async () => {
    let running = 0;
    let most = 0;
    await deleteInTurn(['a', 'b', 'c'], async () => {
      running += 1;
      most = Math.max(most, running);
      await Promise.resolve();
      running -= 1;
    }, () => undefined);
    expect(most).toBe(1);
  });

  it('counts a file already gone as deleted, and keeps a refusal with its reason', async () => {
    const failures: Record<string, unknown> = { b: gone, c: stale, d: timedOut };
    const progress: number[] = [];
    const outcome = await deleteInTurn(['a', 'b', 'c', 'd'], async (id) => { if (failures[id]) throw failures[id]; }, (done) => progress.push(done));
    expect(progress).toEqual([0, 1, 2, 3]);
    expect(outcome).toEqual({ refused: [{ id: 'c', reason: 'The file there has changed.' }], unanswered: ['d'] });
  });

  it('judges a delete that went unanswered by whether the file is still listed', () => {
    const outcome = { refused: [], unanswered: ['d'] };
    expect(deleteOutcomeText(outcome, 4, new Set())).toBeUndefined();
    expect(deleteOutcomeText(outcome, 4, new Set(['d']))).toBe('1 of 4 files had no answer in time and may still be deleted: refresh in a minute.');
  });

  it('names each reason once however many files were refused for it', () => {
    const refusal = (id: string) => ({ id, reason: 'The file there has changed.' });
    expect(deleteOutcomeText({ refused: [refusal('a'), refusal('b')], unanswered: [] }, 5, new Set()))
      .toBe('2 of 5 files were not deleted: The file there has changed.');
  });

  it('calls a refused connection a refusal, since nothing was done', async () => {
    const refused = endpointFailure('fi-1', 'http://fi-1', new MachaConnectionError('connection refused'));
    const outcome = await deleteInTurn(['a'], async () => { throw refused; }, () => undefined);
    expect(outcome.unanswered).toEqual([]);
    expect(outcome.refused).toHaveLength(1);
  });
});

describe('a folder in the file browser', () => {
  it('lists folders first, then by name, whatever order the server sends', () => {
    const entry = (name: string, type: 'file' | 'directory') => ({ name, type, path: `/${name}` }) as unknown as MachaDfsEntry;
    expect(browserOrder([entry('b.mkv', 'file'), entry('Season 10', 'directory'), entry('a.mkv', 'file'), entry('Season 2', 'directory')]).map((e) => e.name))
      .toEqual(['Season 2', 'Season 10', 'a.mkv', 'b.mkv']);
  });
});
