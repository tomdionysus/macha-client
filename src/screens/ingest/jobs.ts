import type { IngestJob, TorrentJob } from '@machafoundation/core';
import { stateLabel } from './format';

export type JobKind = 'ingest' | 'torrent';
export type JobAction = 'pause' | 'resume' | 'retry' | 'remove';

const ingestPauseableStates = new Set(['queued', 'scanning', 'importing']);
const ingestResumableStates = new Set(['paused', 'blocked', 'failed']);
const torrentPauseableStates = new Set(['queued', 'metadata', 'downloading', 'verifying', 'downloaded', 'importing']);
const torrentResumableStates = new Set(['paused', 'blocked']);
const terminalStates = new Set(['completed', 'cancelled', 'failed']);

export function jobKey(kind: JobKind, id: string): string {
  return `${kind}:${id}`;
}

export function canPause(kind: JobKind, state: string): boolean {
  return kind === 'ingest' ? ingestPauseableStates.has(state) : torrentPauseableStates.has(state);
}

export function canResume(kind: JobKind, state: string): boolean {
  return kind === 'ingest' ? ingestResumableStates.has(state) : torrentResumableStates.has(state);
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

/**
 * Where a torrent is on its way into the library: downloaded, then copied in
 * by an import job, then catalogued. Each stage says whether it is waiting,
 * running, done or stopped, so the page answers "why is this not finished"
 * by showing which stage it is stuck in.
 */
export function torrentStages(job: TorrentJob, linkedIngest?: IngestJob): TorrentStage[] {
  const downloaded = Boolean(job.ingest_job_id) || torrentPastDownload.has(job.state) || (job.progress ?? 0) >= 1;
  const download = stageOf(job.state, downloaded);

  const imported = linkedIngest ? linkedIngest.state === 'completed' || linkedIngest.state === 'cataloguing' : false;
  const importStage: Pick<TorrentStage, 'status' | 'label'> = linkedIngest
    ? stageOf(linkedIngest.state, imported)
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
