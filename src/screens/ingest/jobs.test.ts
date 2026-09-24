import { describe, expect, it } from 'vitest';
import type { IngestJob, TorrentJob } from '@machafoundation/core';
import { torrentStages } from './jobs';

function torrent(overrides: Partial<TorrentJob> = {}): TorrentJob {
  return {
    id: 't', name: 'T', info_hash: null, state: 'downloading', bytes_total: 100, bytes_completed: 25,
    download_rate: 0, upload_rate: 0, uploaded_total: 0, peers: 0, seeds: 0,
    catalogue: { total: 0, pending: 0, catalogued: 0, no_match: 0, failed: 0, state: 'waiting' },
    eta_seconds: null, progress: 0.25, ingest_job_id: null, created_unix_ms: 0, updated_unix_ms: 0, error: null,
    ...overrides,
  };
}

function ingest(state: IngestJob['state']): IngestJob {
  return { id: 'i', state } as IngestJob;
}

const statuses = (job: TorrentJob, linked?: IngestJob) => torrentStages(job, linked).map((stage) => `${stage.key}:${stage.status}`);

describe('where a torrent is on its way into the library', () => {
  it('is downloading, with the import and catalogue still to come', () => {
    expect(statuses(torrent())).toEqual(['download:active', 'import:waiting', 'catalogue:waiting']);
  });

  it('is importing once the payload has been handed over', () => {
    expect(statuses(torrent({ state: 'importing', ingest_job_id: 'i' }), ingest('importing')))
      .toEqual(['download:done', 'import:active', 'catalogue:waiting']);
  });

  it('is cataloguing once the import has copied the files in', () => {
    const job = torrent({ state: 'cataloguing', ingest_job_id: 'i', catalogue: { total: 4, pending: 2, catalogued: 2, no_match: 0, failed: 0, state: 'processing' } });
    expect(statuses(job, ingest('cataloguing'))).toEqual(['download:done', 'import:done', 'catalogue:active']);
  });

  it('says a finished torrent that catalogued badly finished with issues, not cleanly', () => {
    const job = torrent({ state: 'completed', ingest_job_id: 'i', catalogue: { total: 2, pending: 0, catalogued: 1, no_match: 1, failed: 0, state: 'completed_with_issues' } });
    expect(statuses(job, ingest('completed'))).toEqual(['download:done', 'import:done', 'catalogue:issues']);
  });

  it('puts a stop on the stage it happened in', () => {
    expect(statuses(torrent({ state: 'failed' }))).toEqual(['download:failed', 'import:waiting', 'catalogue:waiting']);
    expect(statuses(torrent({ state: 'failed', ingest_job_id: 'i' }), ingest('failed'))).toEqual(['download:done', 'import:failed', 'catalogue:waiting']);
    expect(statuses(torrent({ state: 'paused' }))).toEqual(['download:paused', 'import:waiting', 'catalogue:waiting']);
  });
});
