import { codeWords } from '../../text/viewerText';
import type { TorrentJob } from '@machafoundation/core';
import { presentedTime } from '../../diagnostics/timestamps';

export function fileName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/** Null (the job's node is not in view) is unknown and reads "—", not "0 B". */
export function formatBytes(value: number | null): string {
  if (value === null) return '—';
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  const decimals = index === 0 || amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(decimals)} ${units[index]}`;
}

export function formatRate(value: number | null): string {
  return value !== null && value > 0 ? `${formatBytes(value)}/s` : '—';
}

export function formatEta(value: number | null): string {
  if (value === null || value < 0 || !Number.isFinite(value)) return '—';
  if (value < 60) return `${Math.ceil(value)}s`;
  if (value < 3600) return `${Math.ceil(value / 60)}m`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.ceil((value % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function percent(progress: number | null, completed: number | null, total: number | null): number | null {
  if (progress !== null && Number.isFinite(progress)) return Math.max(0, Math.min(100, progress * 100));
  if (total !== null && completed !== null && total > 0) return Math.max(0, Math.min(100, (completed / total) * 100));
  return null;
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value >= 99.95 || value === 0 ? Math.round(value) : value.toFixed(1)}%`;
}

export function formatTimestamp(value: number): string {
  return presentedTime(value);
}

// Floored, where an ETA rounds up: an age counts only what has gone by.
export function formatAge(value: number, now: number): string {
  if (!value) return '—';
  const seconds = Math.floor((now - value) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 48) return `${Math.floor(hours / 24)}d ago`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m ago` : `${hours}h ago`;
}

/** States whose code does not read as words. */
const STATE_LABELS: Record<string, string> = {
  verify_queued: 'Waiting to verify',
  // Added to the cluster, not yet claimed by a node.
  awaiting_node: 'Waiting for a node',
};

/** A count the server may not know (null), as "—". */
export function formatCount(value: number | null): string {
  return value === null ? '—' : String(value);
}

export function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? codeWords(state);
}

/** Share ratio against the bytes this node received, not the torrent's advertised size. */
export function ratioOf(job: TorrentJob): number | null {
  return job.bytes_completed !== null && job.bytes_completed > 0 && job.uploaded_total !== null ? job.uploaded_total / job.bytes_completed : null;
}

export function formatRatio(job: TorrentJob): string {
  const ratio = ratioOf(job);
  return ratio === null ? '—' : ratio.toFixed(2);
}
