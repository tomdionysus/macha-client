// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AcquisitionApi, AcquisitionSnapshot, IngestJob, TorrentJob } from '@machafoundation/core';
import { IngestScreen } from './IngestScreen';

function torrentJob(overrides: Partial<TorrentJob> = {}): TorrentJob {
  return {
    id: 'tor-1',
    name: 'Some.Release.2024.1080p',
    info_hash: 'c2a1f0e9b8d7c6b5a4938271605f4e3d2c1b0a99',
    state: 'downloading',
    bytes_total: 4_000_000_000,
    bytes_completed: 1_000_000_000,
    download_rate: 2_500_000,
    upload_rate: 500_000,
    uploaded_total: 250_000_000,
    peers: 12,
    seeds: 3,
    catalogue: { total: 2, pending: 0, catalogued: 1, no_match: 1, failed: 0, state: 'completed_with_issues' },
    eta_seconds: 1_200,
    progress: 0.25,
    ingest_job_id: null,
    // A real node id, as `GET /api/v1/status` reports it. The fixture used to
    // say `gbni-2`, which is not a thing the server has ever sent, and it made
    // this assertion agree that the Node row is readable when it is not.
    node_id: '855716bd8bb0ad12b0c4f876386699de',
    created_unix_ms: Date.now() - 3_600_000,
    updated_unix_ms: Date.now() - 2_000,
    error: null,
    ...overrides,
  };
}

function snapshot(torrentJobs: TorrentJob[], ingestJobs: IngestJob[] = []): AcquisitionSnapshot {
  return {
    ingestStatus: {
      enabled: true,
      staging: { path: '/srv/staging', limit_bytes: 100, disk_bytes: 100, reserved_bytes: 0, accounted_bytes: 0 },
    },
    torrentStatus: { enabled: true, build_available: true, search_enabled: true },
    ingestJobs,
    torrentJobs,
  };
}

function fakeApi(value: AcquisitionSnapshot): AcquisitionApi {
  const unused = () => { throw new Error('not used in this test'); };
  return {
    snapshot: () => Promise.resolve(value),
    submitPath: unused,
    submitMagnet: unused,
    pauseIngest: unused,
    resumeIngest: unused,
    cancelIngest: unused,
    clearIngest: unused,
    pauseTorrent: unused,
    resumeTorrent: unused,
    retryTorrent: unused,
    cancelTorrent: unused,
    clearTorrent: unused,
  } as unknown as AcquisitionApi;
}

async function renderWithTorrent(job: TorrentJob, ingestJobs: IngestJob[] = []): Promise<HTMLElement> {
  render(<IngestScreen api={fakeApi(snapshot([job], ingestJobs))} />);
  return await screen.findByRole('button', { name: 'Some.Release.2024.1080p details' });
}

describe('torrent detail pane', () => {
  it('stays closed until the torrent is clicked, and closes again on a second click', async () => {
    const heading = await renderWithTorrent(torrentJob());

    expect(screen.queryByText('Info hash')).toBeNull();

    fireEvent.click(heading);
    expect(screen.getByText('Info hash')).not.toBeNull();
    expect(heading.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(heading);
    await waitFor(() => expect(screen.queryByText('Info hash')).toBeNull());
  });

  it('shows only one torrent detail at a time', async () => {
    const other = torrentJob({ id: 'tor-2', name: 'Another.Release', info_hash: 'ff00' });
    render(<IngestScreen api={fakeApi(snapshot([torrentJob(), other]))} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Some.Release.2024.1080p details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Another.Release details' }));

    expect(screen.getAllByText('Info hash')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Some.Release.2024.1080p details' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('reports the facts the card has no room for: hash, node, ratio and cataloguing outcome', async () => {
    fireEvent.click(await renderWithTorrent(torrentJob()));

    const pane = document.querySelector('.ingest-job-detail');
    expect(pane).not.toBeNull();
    const value = (label: string) => [...pane!.querySelectorAll('div')]
      .find((row) => row.querySelector('dt')?.textContent === label)
      ?.querySelector('dd')?.textContent;

    expect(value('Info hash')).toBe('c2a1f0e9b8d7c6b5a4938271605f4e3d2c1b0a99');
    expect(value('Node')).toBe('855716bd8bb0ad12b0c4f876386699de');
    // 250 MB served against the 1 GB this node actually holds.
    expect(value('Ratio')).toBe('0.25');
    expect(value('Age')).toBe('1h ago');
    // A torrent that downloaded cleanly and catalogued nothing is a failed
    // acquisition wearing a completed badge; the counts are the only tell.
    expect(value('State')).toBe('Completed with issues');
    expect(value('Catalogued')).toBe('1 / 2');
    expect(value('No match')).toBe('1');
  });

  it('omits the import group for a torrent that has not been handed to ingest', async () => {
    fireEvent.click(await renderWithTorrent(torrentJob()));

    expect(screen.queryByText('Import job')).toBeNull();
    expect(screen.getByText('Transfer')).not.toBeNull();
  });

  it('reports the linked import job once the payload is being copied in', async () => {
    const ingest: IngestJob = {
      id: 'ing-1',
      source_type: 'torrent',
      source_ref: 'tor-1',
      display_name: 'Some.Release.2024.1080p',
      source_path: '/srv/staging/tor-1',
      remove_source_on_complete: true,
      state: 'importing',
      bytes_total: 4_000_000_000,
      bytes_completed: 2_000_000_000,
      files_total: 4,
      files_completed: 2,
      rate_bytes_per_second: 40_000_000,
      eta_seconds: 50,
      progress: 0.5,
      current_file: 'episode-03.mkv',
      current_destination: '/macha/shows/some-release/episode-03.mkv',
      created_unix_ms: Date.now() - 60_000,
      updated_unix_ms: Date.now(),
      error: null,
    };
    fireEvent.click(await renderWithTorrent(torrentJob({ ingest_job_id: 'ing-1' }), [ingest]));

    expect(screen.getByText('Import job')).not.toBeNull();
    expect(screen.getByText('/srv/staging/tor-1')).not.toBeNull();
    expect(screen.getByText('episode-03.mkv')).not.toBeNull();
    expect(screen.getByText('/macha/shows/some-release/episode-03.mkv')).not.toBeNull();
  });
});
