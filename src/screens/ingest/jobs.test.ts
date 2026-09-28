import { describe, expect, it } from 'vitest';
import type { IngestJob, TorrentJob } from '@machafoundation/core';
import { storingOf, storingPercent, storingStallText, torrentStages } from './jobs';

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

describe('the download being stored in the cluster, before the import (server 0.71.0)', () => {
  const publication = { published_extents: 246, extents: 624, published_bytes: 1_031_798_784, bytes: 2_607_096_508, progress_age_ms: 2_000 };
  const storing = (overrides: Partial<TorrentJob> = {}) => torrent({ state: 'downloaded', progress: 1, bytes_completed: 100, waiting_reason: 'extent_publication', publication, ...overrides });

  it('shows the import stage as storing, not as starting, while the server says it is waiting on it', () => {
    const [, importStage] = torrentStages(storing());
    expect(importStage).toEqual({ key: 'import', status: 'active', label: 'Storing in the cluster' });
    expect(storingPercent(storingOf(storing())!)).toBeCloseTo(39.42, 1);
  });

  it("takes the server's reason, not the state, and nothing once storing is complete or the node says nothing", () => {
    expect(storingOf(storing({ waiting_reason: null }))).toBeUndefined();
    expect(storingOf(storing({ publication: { ...publication, published_extents: 624 } }))).toBeUndefined();
    expect(storingOf(storing({ publication: null }))).toBeUndefined();
    expect(torrentStages(storing({ waiting_reason: null }))[1].label).toBe('Starting');
  });

  it('says it has stood still once a minute has gone by with no progress, and not before', () => {
    expect(storingStallText({ ...publication, progress_age_ms: 59_999 })).toBeUndefined();
    expect(storingStallText({ ...publication, progress_age_ms: 4 * 60_000 + 30_000 })).toBe('no progress for 4 min');
  });
});
