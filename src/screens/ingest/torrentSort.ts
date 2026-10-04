import type { TorrentJob } from '@machafoundation/core';
import { percent, ratioOf } from './format';
import { sortRows, type ListSort, type SortKeyDef } from '../../lists/listSort';

export type TorrentSortKey = 'added' | 'name' | 'size' | 'progress' | 'status' | 'down' | 'up' | 'eta' | 'ratio';
export type TorrentSort = ListSort<TorrentSortKey>;

/** Sort keys with their default directions: names A to Z; speeds, sizes and dates largest or newest first. */
export const TORRENT_SORT_KEYS: readonly SortKeyDef<TorrentSortKey>[] = [
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

/** Moving work, then waiting, then finished. */
const STATUS_ORDER = [
  'downloading', 'metadata', 'verifying', 'downloaded', 'importing', 'scanning', 'cataloguing',
  'verify_queued', 'queued', 'awaiting_node', 'paused', 'blocked', 'failed', 'completed', 'cancelled',
];

function statusRank(state: string): number {
  const index = STATUS_ORDER.indexOf(state);
  return index === -1 ? STATUS_ORDER.length : index;
}

/** The value a job sorts on, or `undefined` for one the server cannot say yet. */
function sortValue(job: TorrentJob, key: TorrentSortKey, state: string): number | string | undefined {
  switch (key) {
    case 'added': return job.created_unix_ms || undefined;
    case 'name': return job.name || undefined;
    case 'size': return job.bytes_total !== null && job.bytes_total > 0 ? job.bytes_total : undefined;
    case 'progress': return percent(job.progress, job.bytes_completed, job.bytes_total) ?? undefined;
    case 'status': return statusRank(state);
    case 'down': return job.download_rate ?? undefined;
    case 'up': return job.upload_rate ?? undefined;
    case 'eta': return job.eta_seconds !== null && job.eta_seconds >= 0 && Number.isFinite(job.eta_seconds) ? job.eta_seconds : undefined;
    case 'ratio': return ratioOf(job) ?? undefined;
  }
}

/**
 * Stable for the same jobs: ties fall to name, then job id, so a reordered poll never
 * swaps rows. Values the server cannot say yet sort last in either direction.
 */
export function sortTorrents(
  jobs: readonly TorrentJob[],
  sort: TorrentSort,
  stateOf: (job: TorrentJob) => string,
): TorrentJob[] {
  return sortRows(jobs, sort, (job, key) => sortValue(job, key, stateOf(job)), (job) => job.name || '', (job) => job.id);
}
