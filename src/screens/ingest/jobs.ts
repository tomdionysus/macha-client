import type { IngestJob, TorrentJob, TorrentPublication } from '@machafoundation/core';
import { stateLabel } from './format';

export type JobKind = 'ingest' | 'torrent';
export type JobAction = 'pause' | 'resume' | 'retry' | 'remove';

const ingestPauseableStates = new Set(['queued', 'scanning', 'importing']);
const ingestResumableStates = new Set(['paused', 'blocked', 'failed']);
// `verify_queued`: waiting on another torrent's check, as libtorrent checks one at a time.
// `awaiting_node`: not yet claimed; an action there is intent, applied once a node claims it.
const torrentPauseableStates = new Set(['awaiting_node', 'queued', 'metadata', 'downloading', 'verify_queued', 'verifying', 'downloaded', 'importing']);
const torrentResumableStates = new Set(['paused', 'blocked']);
const terminalStates = new Set(['completed', 'cancelled', 'failed']);

export function jobKey(kind: JobKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * A torrent's `desired` decides as much as its state: one added paused has `desired` "paused" and
 * a state that never says so. The server resumes whenever `desired` is "paused".
 */
export function canPause(kind: JobKind, state: string, desired?: string): boolean {
  return kind === 'ingest' ? ingestPauseableStates.has(state) : torrentPauseableStates.has(state) && desired !== 'paused';
}

export function canResume(kind: JobKind, state: string, desired?: string): boolean {
  if (kind === 'ingest') return ingestResumableStates.has(state);
  return torrentResumableStates.has(state) || (desired === 'paused' && !isTerminal(state));
}

/** "Paused" for a torrent held by request whose state does not say so: "Paused, waiting for a node". */
export function heldStatus(job: Pick<TorrentJob, 'state' | 'desired'>): string | undefined {
  if (job.desired !== 'paused' || torrentResumableStates.has(job.state) || isTerminal(job.state)) return undefined;
  return job.state === 'awaiting_node' ? 'Paused, waiting for a node' : 'Paused';
}

export function isTerminal(state: string): boolean {
  return terminalStates.has(state);
}

/** The import job a torrent handed its payload to, once it has. */
export function linkedIngestOf(job: TorrentJob, ingestJobs: readonly IngestJob[] | undefined): IngestJob | undefined {
  return job.ingest_job_id ? ingestJobs?.find((candidate) => candidate.id === job.ingest_job_id) : undefined;
}

/** What a viewer is shown: once a torrent is importing, the import is its state. */
export function displayStateOf(job: TorrentJob, linkedIngest?: IngestJob): string {
  return linkedIngest?.state ?? job.state;
}

/**
 * The download being stored in the cluster before its import starts, which can take many minutes.
 * Read from the server's reason, never rebuilt from the state, and only while incomplete.
 */
export function storingOf(job: TorrentJob): TorrentPublication | undefined {
  const publication = job.publication;
  return job.waiting_reason === 'extent_publication' && publication && publication.published_extents < publication.extents
    ? publication
    : undefined;
}

/** How far storing has got, from the extents; undefined when there are none to count. */
export function storingPercent(publication: TorrentPublication): number | undefined {
  return publication.extents > 0 ? Math.max(0, Math.min(100, publication.published_extents / publication.extents * 100)) : undefined;
}

/** "no progress for 4 min" once storing has stood still for a minute, since a flat figure alone does not say stuck. */
export function storingStallText(publication: TorrentPublication): string | undefined {
  const minutes = Math.floor(publication.progress_age_ms / 60_000);
  return minutes >= 1 ? `no progress for ${minutes} min` : undefined;
}

export function canRetryImport(job: TorrentJob, linkedIngest?: IngestJob): boolean {
  return job.state === 'failed' && Boolean(job.ingest_job_id) && linkedIngest?.state === 'failed';
}

export function torrentLifecycleMessage(job: TorrentJob, linkedIngest?: IngestJob): string | undefined {
  if (!job.ingest_job_id) return undefined;
  const state = linkedIngest?.state ?? job.state;
  if (state === 'completed') return 'Imported into Macha.';
  if (state === 'cataloguing') return 'Imported into the Macha namespace; cataloguing media.';
  if (state === 'cancelled') return 'Import cancelled.';
  if (state === 'failed') return undefined;
  return 'Downloaded; importing into the Macha namespace.';
}

export type StageStatus = 'waiting' | 'active' | 'paused' | 'done' | 'issues' | 'failed';
export interface TorrentStage {
  key: 'download' | 'import' | 'catalogue';
  status: StageStatus;
  label: string;
}

const torrentPastDownload = new Set(['downloaded', 'importing', 'cataloguing', 'completed']);
const stoppedStates = new Set(['failed', 'cancelled', 'blocked']);

function stageOf(state: string, done: boolean): Pick<TorrentStage, 'status' | 'label'> {
  if (done) return { status: 'done', label: 'Complete' };
  if (stoppedStates.has(state)) return { status: 'failed', label: stateLabel(state) };
  if (state === 'paused') return { status: 'paused', label: 'Paused' };
  return { status: 'active', label: stateLabel(state) };
}

/** A torrent's stages into the library (download, import, catalogue), so the page shows which one it is stuck in. */
export function torrentStages(job: TorrentJob, linkedIngest?: IngestJob): TorrentStage[] {
  const downloaded = Boolean(job.ingest_job_id) || torrentPastDownload.has(job.state) || (job.progress ?? 0) >= 1;
  const download = stageOf(job.state, downloaded);

  const imported = linkedIngest ? linkedIngest.state === 'completed' || linkedIngest.state === 'cataloguing' : false;
  const importStage: Pick<TorrentStage, 'status' | 'label'> = linkedIngest
    ? stageOf(linkedIngest.state, imported)
    : storingOf(job)
      ? { status: 'active', label: 'Storing in the cluster' }
      : { status: 'waiting', label: downloaded ? 'Starting' : 'After the download' };

  const catalogue = job.catalogue;
  const catalogueStage: Pick<TorrentStage, 'status' | 'label'> = !catalogue || catalogue.state === 'waiting'
    ? { status: 'waiting', label: 'After the import' }
    : catalogue.state === 'processing'
      ? { status: 'active', label: 'Cataloguing' }
      : catalogue.state === 'completed_with_issues'
        ? { status: 'issues', label: 'Completed with issues' }
        : { status: 'done', label: 'Complete' };

  return [
    { key: 'download', ...download },
    { key: 'import', ...importStage },
    { key: 'catalogue', ...catalogueStage },
  ];
}
