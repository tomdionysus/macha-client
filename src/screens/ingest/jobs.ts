import type { IngestJob, TorrentJob } from '@machafoundation/core';

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
