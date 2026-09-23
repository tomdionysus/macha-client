import { describe, expect, it } from 'vitest';
import type { TorrentJob } from '@machafoundation/core';
import { DEFAULT_TORRENT_SORT, parseTorrentSort, sortTorrents, torrentSortParams, type TorrentSort } from './torrentSort';

function job(overrides: Partial<TorrentJob>): TorrentJob {
  return {
    id: 'tor-1',
    name: 'Release',
    info_hash: '',
    state: 'downloading',
    bytes_total: 1_000,
    bytes_completed: 500,
    download_rate: 0,
    upload_rate: 0,
    uploaded_total: 0,
    peers: 0,
    seeds: 0,
    catalogue: undefined,
    eta_seconds: null,
    progress: 0.5,
    ingest_job_id: null,
    node_id: null,
    created_unix_ms: 1_000,
    updated_unix_ms: 1_000,
    error: null,
    ...overrides,
  } as TorrentJob;
}

const ids = (jobs: readonly TorrentJob[]) => jobs.map((entry) => entry.id);
const stateOf = (entry: TorrentJob) => entry.state;
const sorted = (jobs: TorrentJob[], sort: TorrentSort) => ids(sortTorrents(jobs, sort, stateOf));

describe('the order torrents are listed in', () => {
  it('is newest added first until the viewer picks something else', () => {
    const jobs = [job({ id: 'old', created_unix_ms: 1 }), job({ id: 'new', created_unix_ms: 3 }), job({ id: 'mid', created_unix_ms: 2 })];
    expect(sorted(jobs, DEFAULT_TORRENT_SORT)).toEqual(['new', 'mid', 'old']);
  });

  it('is the same however the server happened to order them', () => {
    // Ties on the sort key fall to the name, compared as a person would, then
    // to the job id, so two polls of the same jobs never swap rows.
    const jobs = [
      job({ id: 'c', name: 'Show S01E10' }),
      job({ id: 'a', name: 'Show S01E2' }),
      job({ id: 'b', name: 'Show S01E2' }),
    ];
    const sort: TorrentSort = { key: 'size', direction: 'asc' };
    expect(sorted(jobs, sort)).toEqual(['a', 'b', 'c']);
    expect(sorted([...jobs].reverse(), sort)).toEqual(['a', 'b', 'c']);
  });

  it('keeps what it cannot know at the bottom whichever way it runs', () => {
    const jobs = [job({ id: 'unknown', eta_seconds: null }), job({ id: 'soon', eta_seconds: 10 }), job({ id: 'later', eta_seconds: 900 })];
    expect(sorted(jobs, { key: 'eta', direction: 'asc' })).toEqual(['soon', 'later', 'unknown']);
    expect(sorted(jobs, { key: 'eta', direction: 'desc' })).toEqual(['later', 'soon', 'unknown']);
  });

  it('has no ratio for a torrent that holds nothing yet', () => {
    const jobs = [
      job({ id: 'empty', bytes_completed: 0, uploaded_total: 0 }),
      job({ id: 'half', bytes_completed: 100, uploaded_total: 50 }),
      job({ id: 'double', bytes_completed: 100, uploaded_total: 200 }),
    ];
    expect(sorted(jobs, { key: 'ratio', direction: 'desc' })).toEqual(['double', 'half', 'empty']);
  });

  it('puts work in progress ahead of work that is finished when sorting by status', () => {
    const jobs = [
      job({ id: 'done', state: 'completed' }),
      job({ id: 'stuck', state: 'failed' }),
      job({ id: 'going', state: 'downloading' }),
      job({ id: 'held', state: 'paused' }),
    ];
    expect(sorted(jobs, { key: 'status', direction: 'asc' })).toEqual(['going', 'held', 'stuck', 'done']);
  });

  it('sorts by the state the viewer is shown, not the raw torrent state', () => {
    const jobs = [job({ id: 'imported', state: 'completed', ingest_job_id: 'i' }), job({ id: 'going', state: 'downloading' })];
    const importing = (entry: TorrentJob) => (entry.id === 'imported' ? 'importing' : entry.state);
    expect(ids(sortTorrents(jobs, { key: 'status', direction: 'desc' }, importing))).toEqual(['imported', 'going']);
  });
});

describe('the sort, as it travels in the address', () => {
  it('round-trips through the query string', () => {
    const sort: TorrentSort = { key: 'down', direction: 'asc' };
    expect(parseTorrentSort(new URLSearchParams(torrentSortParams(sort)))).toEqual(sort);
  });

  it('falls back rather than failing on an address somebody edited', () => {
    expect(parseTorrentSort(new URLSearchParams('sort=nonsense&dir=sideways'))).toEqual(DEFAULT_TORRENT_SORT);
  });

  it('gives a key its natural direction when none is stated', () => {
    expect(parseTorrentSort(new URLSearchParams('sort=name'))).toEqual({ key: 'name', direction: 'asc' });
    expect(parseTorrentSort(new URLSearchParams('sort=down'))).toEqual({ key: 'down', direction: 'desc' });
  });
});
