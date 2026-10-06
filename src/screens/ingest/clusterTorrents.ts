import type { AcquisitionSource, TorrentJob, TorrentNode } from '@machafoundation/core';
import { formatAge, formatBytes } from './format';

/**
 * An action is intent: the server records `desired` at once and the owning node applies it within
 * seconds, reporting `desired_applied`. These words cover the gap.
 */
const PENDING: Record<string, string> = { paused: 'Pausing…', active: 'Resuming…', cancelled: 'Cancelling…' };
const WAITING: Record<string, string> = { paused: 'Pause waiting', active: 'Resume waiting', cancelled: 'Cancel waiting' };
const BLOCKED: Record<string, string> = {
  owner_unreachable: 'its node is out of reach',
  pinned_node_unavailable: 'the node it is pinned to is unavailable',
  no_capable_node: 'no node can take torrents',
};

/**
 * What to say about an action not yet applied, if anything. An intent unapplied after two refresh
 * intervals with no reason given counts as stuck, as the server counts it.
 */
export function intentNote(job: Pick<TorrentJob, 'desired' | 'desired_applied' | 'desired_blocked_reason' | 'desired_changed_unix_ms'>, now: number, refreshIntervalMs: number): string | undefined {
  if (!job.desired || job.desired_applied !== false) return undefined;
  if (job.desired_blocked_reason) return `${WAITING[job.desired] ?? 'Waiting'}: ${BLOCKED[job.desired_blocked_reason] ?? job.desired_blocked_reason.replace(/_/g, ' ')}`;
  const since = job.desired_changed_unix_ms;
  if (since && now - since > 2 * refreshIntervalMs) return `${WAITING[job.desired] ?? 'Waiting'}: not applied yet`;
  return PENDING[job.desired];
}

/** From immediate up to the server's maximum of a day. */
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

/** A null or undefined default means the cluster keeps completed torrents. */
export function removeAfterDefaultLabel(defaultMs: number | null | undefined): string {
  return defaultMs === null || defaultMs === undefined ? 'Keep it (the default)' : `Default: remove ${durationWords(defaultMs)}`;
}

const NOT_ACCEPTING: Record<string, string> = {
  slots_full: 'all slots busy',
  staging_full: 'staging full',
  draining: 'draining',
  unreachable: 'unreachable',
};

/**
 * A node in the add form's selector: host, load or why it is not accepting, and its own staging
 * room. A node not accepting can still be chosen; the torrent waits for it.
 */
/**
 * Where a job is: the node downloading it, then the node importing it where that differs,
 * as "gbni-1 → fi-1"; undefined while no node holds either.
 */
export function jobNodesText(job: Pick<TorrentJob, 'node_id' | 'ingest_node_id'>, hosts: ReadonlyMap<string, string>): string | undefined {
  const download = jobNodeName(job.node_id, hosts);
  const ingest = job.ingest_node_id && job.ingest_node_id !== job.node_id ? jobNodeName(job.ingest_node_id, hosts) : undefined;
  return download && ingest ? `${download} → ${ingest}` : download ?? ingest;
}

/** The node a job runs on, by host, as the node list names it; undefined while no node has claimed it. */
export function jobNodeName(nodeId: string | null | undefined, hosts: ReadonlyMap<string, string>): string | undefined {
  if (!nodeId) return undefined;
  return hosts.get(nodeId) || `Node ${nodeId.slice(0, 8)}`;
}

export function torrentNodeLabel(node: Pick<TorrentNode, 'host' | 'node_id' | 'accepting' | 'not_accepting_reason' | 'active_jobs' | 'max_active'> & { staging?: Pick<TorrentNode['staging'], 'free_bytes' | 'limit_bytes'> }): string {
  const name = node.host || node.node_id;
  const load = node.accepting
    ? `${node.active_jobs} of ${node.max_active} running`
    : node.not_accepting_reason ? NOT_ACCEPTING[node.not_accepting_reason] ?? node.not_accepting_reason.replace(/_/g, ' ') : 'not taking torrents';
  const room = node.staging && node.staging.limit_bytes > 0
    ? ` · ${formatBytes(node.staging.free_bytes)} free of ${formatBytes(node.staging.limit_bytes)}`
    : '';
  return `${name} (${load}${room})`;
}

/**
 * Notes on the nodes a list could not hear from. A node out of reach has its jobs listed as of its
 * last answer; a node never reached has none listed.
 */
export function staleSourceNotes(sources: readonly AcquisitionSource[], hosts: ReadonlyMap<string, string>, now: number): string[] {
  return sources.filter((source) => !source.reachable).map((source) => {
    const name = hosts.get(source.node_id) ?? `Node ${source.node_id.slice(0, 8)}`;
    return source.as_of_unix_ms === null
      ? `${name} has not answered, so its jobs are missing from this list.`
      : `${name} is out of reach, so its jobs are shown as they were ${formatAge(source.as_of_unix_ms, now)}.`;
  });
}
