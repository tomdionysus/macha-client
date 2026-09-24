import { codeWords } from '../../text/viewerText';
import type { TorrentJob } from '@machafoundation/core';
import { presentedTime } from '../../diagnostics/timestamps';

export function formatBytes(value: number): string {
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

export function formatRate(value: number): string {
  return value > 0 ? `${formatBytes(value)}/s` : '—';
}

export function formatEta(value: number | null): string {
  if (value === null || value < 0 || !Number.isFinite(value)) return '—';
  if (value < 60) return `${Math.ceil(value)}s`;
  if (value < 3600) return `${Math.ceil(value / 60)}m`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.ceil((value % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function percent(progress: number | null, completed: number, total: number): number | null {
  if (progress !== null && Number.isFinite(progress)) return Math.max(0, Math.min(100, progress * 100));
  if (total > 0) return Math.max(0, Math.min(100, (completed / total) * 100));
  return null;
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value >= 99.95 || value === 0 ? Math.round(value) : value.toFixed(1)}%`;
}

export function formatTimestamp(value: number): string {
  return presentedTime(value);
}

// Elapsed time, floored: an ETA rounds up because it promises no earlier than
// it says, while an age counts what has actually gone by. Sharing formatEta
// here reported a job created 3600.4s ago as "1h 1m old".
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

export function stateLabel(state: string): string {
  return codeWords(state);
}

/**
 * Share ratio against what this node actually received, not against the
 * torrent's advertised size: a job that has fetched a tenth of the payload and
 * uploaded the same amount has served its peers a full ratio of what it holds.
 */
export function ratioOf(job: TorrentJob): number | null {
  return job.bytes_completed > 0 ? job.uploaded_total / job.bytes_completed : null;
}

export function formatRatio(job: TorrentJob): string {
  const ratio = ratioOf(job);
  return ratio === null ? '—' : ratio.toFixed(2);
}
