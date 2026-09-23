import type { TorrentJob } from '@machafoundation/core';
import { percent, ratioOf } from './format';

export type TorrentSortKey = 'added' | 'name' | 'size' | 'progress' | 'status' | 'down' | 'up' | 'eta' | 'ratio';
export type SortDirection = 'asc' | 'desc';
export interface TorrentSort {
  key: TorrentSortKey;
  direction: SortDirection;
}

/**
 * The keys a viewer can sort by, with the direction each is naturally read
 * in: names A to Z, but speeds, sizes and dates largest or newest first.
 */
export const TORRENT_SORT_KEYS: readonly { key: TorrentSortKey; label: string; direction: SortDirection }[] = [
  { key: 'added', label: 'Added', direction: 'desc' },
  { key: 'name', label: 'Name', direction: 'asc' },
  { key: 'size', label: 'Size', direction: 'desc' },
  { key: 'progress', label: 'Progress', direction: 'desc' },
  { key: 'status', label: 'Status', direction: 'asc' },
  { key: 'down', label: 'Down speed', direction: 'desc' },
  { key: 'up', label: 'Up speed', direction: 'desc' },
  { key: 'eta', label: 'ETA', direction: 'asc' },
  { key: 'ratio', label: 'Ratio', direction: 'desc' },
];

export const DEFAULT_TORRENT_SORT: TorrentSort = { key: 'added', direction: 'desc' };

/**
 * Work that is moving, then work that is waiting, then work that is over.
 * Alphabetical would put "Cancelled" and "Completed" at the top, which is the
 * part of the list nobody is watching.
 */
const STATUS_ORDER = [
  'downloading', 'metadata', 'verifying', 'downloaded', 'importing', 'scanning', 'cataloguing',
  'queued', 'paused', 'blocked', 'failed', 'completed', 'cancelled',
];

function statusRank(state: string): number {
  const index = STATUS_ORDER.indexOf(state);
  return index === -1 ? STATUS_ORDER.length : index;
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The value a job sorts on, or `undefined` for one the server cannot say yet. */
function sortValue(job: TorrentJob, key: TorrentSortKey, state: string): number | string | undefined {
  switch (key) {
    case 'added': return job.created_unix_ms || undefined;
    case 'name': return job.name || undefined;
    case 'size': return job.bytes_total > 0 ? job.bytes_total : undefined;
    case 'progress': return percent(job.progress, job.bytes_completed, job.bytes_total) ?? undefined;
    case 'status': return statusRank(state);
    case 'down': return job.download_rate;
    case 'up': return job.upload_rate;
    case 'eta': return job.eta_seconds !== null && job.eta_seconds >= 0 && Number.isFinite(job.eta_seconds) ? job.eta_seconds : undefined;
    case 'ratio': return ratioOf(job) ?? undefined;
  }
}

function compareValues(left: number | string, right: number | string): number {
  if (typeof left === 'string' && typeof right === 'string') return COLLATOR.compare(left, right);
  return Number(left) - Number(right);
}

/**
 * The torrents in the order the viewer asked for, and always the same order
 * for the same jobs: ties fall to the name and then to the job id, so a poll
 * that returns the jobs in a different order never swaps two rows under the
 * pointer. What the server cannot say yet sorts last whichever way the list
 * runs, because a row of dashes is never what somebody sorted to find.
 */
export function sortTorrents(
  jobs: readonly TorrentJob[],
  sort: TorrentSort,
  stateOf: (job: TorrentJob) => string,
): TorrentJob[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...jobs].sort((left, right) => {
    const a = sortValue(left, sort.key, stateOf(left));
    const b = sortValue(right, sort.key, stateOf(right));
    if (a === undefined && b !== undefined) return 1;
    if (b === undefined && a !== undefined) return -1;
    const primary = a !== undefined && b !== undefined ? sign * compareValues(a, b) : 0;
    return primary
      || COLLATOR.compare(left.name || '', right.name || '')
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  });
}

function isSortKey(value: string | null): value is TorrentSortKey {
  return TORRENT_SORT_KEYS.some((entry) => entry.key === value);
}

/** Read from the address, falling back rather than failing on one that was edited. */
export function parseTorrentSort(params: URLSearchParams): TorrentSort {
  const key = params.get('sort');
  if (!isSortKey(key)) return DEFAULT_TORRENT_SORT;
  const direction = params.get('dir');
  return {
    key,
    direction: direction === 'asc' || direction === 'desc'
      ? direction
      : TORRENT_SORT_KEYS.find((entry) => entry.key === key)!.direction,
  };
}

export function torrentSortParams(sort: TorrentSort): Record<string, string> {
  return { sort: sort.key, dir: sort.direction };
}
