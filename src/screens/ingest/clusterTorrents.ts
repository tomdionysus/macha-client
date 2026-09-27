import type { TorrentJob, TorrentNode } from '@machafoundation/core';

/**
 * Server 0.64.0: torrents belong to the cluster. An action is intent: the
 * server records `desired` at once and the owning node applies it within
 * seconds, reporting `desired_applied`. Until then the viewer is told what is
 * under way, and why it is waiting when the server says it cannot apply it.
 */
const PENDING: Record<string, string> = { paused: 'Pausing…', active: 'Resuming…', cancelled: 'Cancelling…' };
const WAITING: Record<string, string> = { paused: 'Pause waiting', active: 'Resume waiting', cancelled: 'Cancel waiting' };
const BLOCKED: Record<string, string> = {
  owner_unreachable: 'its node is out of reach',
  pinned_node_unavailable: 'the node it is pinned to is unavailable',
  no_capable_node: 'no node can take torrents',
};

/**
 * What to say about an action not yet applied, or nothing. `now` and the
 * list's refresh interval tell a slow owner from a stuck one: the server
 * counts an intent not applied within two intervals, with no reason given, as
 * stuck.
 */
export function intentNote(job: Pick<TorrentJob, 'desired' | 'desired_applied' | 'desired_blocked_reason' | 'desired_changed_unix_ms'>, now: number, refreshIntervalMs: number): string | undefined {
  if (!job.desired || job.desired_applied !== false) return undefined;
  if (job.desired_blocked_reason) return `${WAITING[job.desired] ?? 'Waiting'}: ${BLOCKED[job.desired_blocked_reason] ?? job.desired_blocked_reason.replace(/_/g, ' ')}`;
  const since = job.desired_changed_unix_ms;
  if (since && now - since > 2 * refreshIntervalMs) return `${WAITING[job.desired] ?? 'Waiting'}: not applied yet`;
  return PENDING[job.desired];
}

/** The remove-after-completion choices on the add form, from off to the server's maximum of a day. */
export const REMOVE_AFTER_CHOICES: ReadonlyArray<{ label: string; ms: number }> = [
  { label: 'As soon as it completes', ms: 0 },
  { label: '1 hour after it completes', ms: 3_600_000 },
  { label: '6 hours after it completes', ms: 21_600_000 },
  { label: '1 day after it completes', ms: 86_400_000 },
];

function durationWords(ms: number): string {
  if (ms === 0) return 'as soon as it completes';
  const hours = ms / 3_600_000;
  if (hours >= 1 && Number.isInteger(hours)) return hours === 24 ? '1 day after it completes' : `${hours} hour${hours === 1 ? '' : 's'} after it completes`;
  return `${Math.round(ms / 60_000)} minutes after it completes`;
}

/** The "default" choice, saying what the cluster default is (null means off). */
export function removeAfterDefaultLabel(defaultMs: number | null | undefined): string {
  return defaultMs === null || defaultMs === undefined ? 'Keep it (the default)' : `Default: remove ${durationWords(defaultMs)}`;
}

const NOT_ACCEPTING: Record<string, string> = {
  slots_full: 'all slots busy',
  staging_full: 'staging full',
  draining: 'draining',
  unreachable: 'unreachable',
};

/** A node in the add form's selector: its host, and why it is not taking work now. It can still be chosen; the torrent then waits for it. */
export function torrentNodeLabel(node: Pick<TorrentNode, 'host' | 'node_id' | 'accepting' | 'not_accepting_reason' | 'active_jobs' | 'max_active'>): string {
  const name = node.host || node.node_id;
  if (node.accepting) return `${name} (${node.active_jobs} of ${node.max_active} running)`;
  const why = node.not_accepting_reason ? NOT_ACCEPTING[node.not_accepting_reason] ?? node.not_accepting_reason.replace(/_/g, ' ') : 'not taking torrents';
  return `${name} (${why})`;
}
