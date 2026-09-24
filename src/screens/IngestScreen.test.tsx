// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AcquisitionApi, AcquisitionSnapshot, IngestJob, TorrentJob } from '@machafoundation/core';
import { IngestScreen } from './IngestScreen';
import { TorrentDetailScreen } from './TorrentDetailScreen';

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

function fakeApi(value: AcquisitionSnapshot | (() => AcquisitionSnapshot), overrides: Partial<AcquisitionApi> = {}): AcquisitionApi {
  const unused = () => { throw new Error('not used in this test'); };
  return {
    snapshot: () => Promise.resolve(typeof value === 'function' ? value() : value),
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
    ...overrides,
  } as unknown as AcquisitionApi;
}


const importing: IngestJob = {
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

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function renderAt(path: string, value: AcquisitionSnapshot, api = fakeApi(value)) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/ingest/torrents" element={<IngestScreen api={api} section="torrents" />} />
        <Route path="/ingest/files" element={<IngestScreen api={api} section="files" />} />
        <Route path="/ingest/torrents/:torrentId" element={<TorrentDetailScreen api={api} />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

async function rowNames(): Promise<string[]> {
  const table = await screen.findByRole('table', { name: /torrents/i });
  return [...table.querySelectorAll('tbody tr .col-name')].map((cell) => cell.textContent ?? '');
}

const three = [
  torrentJob({ id: 'a', name: 'Alpha', created_unix_ms: 1_000, download_rate: 10 }),
  torrentJob({ id: 'b', name: 'Bravo', created_unix_ms: 3_000, download_rate: 30 }),
  torrentJob({ id: 'c', name: 'Charlie', created_unix_ms: 2_000, download_rate: 20 }),
];

describe('the torrent list', () => {
  it('is one slim row per torrent, newest first until asked otherwise', async () => {
    renderAt('/ingest/torrents', snapshot(three));
    await screen.findByText('Alpha');
    expect(await rowNames()).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(document.querySelectorAll('.torrent-table tbody tr')).toHaveLength(3);
  });

  it('reorders when the viewer picks a sort, and says so in the address', async () => {
    renderAt('/ingest/torrents', snapshot(three));
    await screen.findByText('Alpha');
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'name' } });
    expect(await rowNames()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(screen.getByTestId('where').textContent).toBe('/ingest/torrents?sort=name&dir=asc');

    fireEvent.click(screen.getByRole('button', { name: /Ascending; switch to descending/ }));
    expect(await rowNames()).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it('sorts from a column header, and reverses on a second press', async () => {
    renderAt('/ingest/torrents', snapshot(three));
    await screen.findByText('Alpha');
    const header = within(document.querySelector('.torrent-table thead') as HTMLElement).getByRole('button', { name: /Down/ });
    fireEvent.click(header);
    expect(await rowNames()).toEqual(['Bravo', 'Charlie', 'Alpha']);
    fireEvent.click(header);
    expect(await rowNames()).toEqual(['Alpha', 'Charlie', 'Bravo']);
  });

  it('opens a torrent on its own page, keeping the sort for the way back', async () => {
    renderAt('/ingest/torrents?sort=name&dir=desc', snapshot(three));
    fireEvent.click(await screen.findByRole('link', { name: 'Alpha' }));
    expect(screen.getByTestId('where').textContent).toBe('/ingest/torrents/a?sort=name&dir=desc');
    fireEvent.click(await screen.findByRole('link', { name: '← Torrents' }));
    expect(screen.getByTestId('where').textContent).toBe('/ingest/torrents?sort=name&dir=desc');
  });

  it('keeps the detail off the list', async () => {
    renderAt('/ingest/torrents', snapshot([torrentJob()]));
    await screen.findByText('Some.Release.2024.1080p');
    expect(screen.queryByText('Info hash')).toBeNull();
  });
});

describe("a torrent's own page", () => {
  /** A labelled value from the facts list inside `scope`. */
  const fact = (scope: Element, label: string) => [...scope.querySelectorAll('.facts > div')]
    .find((row) => row.querySelector('dt')?.textContent === label)
    ?.querySelector('dd')?.textContent;
  const stage = (key: string) => document.getElementById(`stage-${key}`)!.closest('.torrent-stage')!;
  const tile = (label: string) => [...document.querySelectorAll('.metric-tile')]
    .find((node) => node.querySelector('span')?.textContent === label)?.querySelector('strong')?.textContent;

  it('reports the facts the list has no room for: hash, node, ratio and cataloguing outcome', async () => {
    renderAt('/ingest/torrents/tor-1', snapshot([torrentJob()]));
    await screen.findByRole('heading', { name: 'Some.Release.2024.1080p' });
    const identity = document.querySelector('.detail-card')!;

    expect(fact(identity, 'Info hash')).toBe('c2a1f0e9b8d7c6b5a4938271605f4e3d2c1b0a99');
    expect(fact(identity, 'Node')).toBe('855716bd8bb0ad12b0c4f876386699de');
    // 250 MB served against the 1 GB this node actually holds.
    expect(tile('Ratio')).toBe('0.25');
    expect(tile('Added')).toBe('1h ago');
    // A torrent that downloaded cleanly and catalogued nothing is a failed
    // acquisition wearing a completed badge; the counts are the only tell.
    const catalogue = stage('catalogue');
    expect(catalogue.querySelector('.torrent-stage-status')?.textContent).toBe('Completed with issues');
    expect(fact(catalogue, 'Catalogued')).toBe('1 / 2');
    expect(fact(catalogue, 'No match')).toBe('1');
  });

  it('shows the import as still to come for a torrent that has not been handed to ingest', async () => {
    renderAt('/ingest/torrents/tor-1', snapshot([torrentJob()]));
    await screen.findByRole('heading', { name: 'Import' });
    expect(stage('import').classList).toContain('stage-waiting');
    expect(fact(stage('import'), 'Staged at')).toBeUndefined();
  });

  it('reports the linked import job once the payload is being copied in', async () => {
    renderAt('/ingest/torrents/tor-1', snapshot([torrentJob({ ingest_job_id: 'ing-1' })], [importing]));
    await screen.findByRole('heading', { name: 'Import' });
    const copying = stage('import');
    expect(copying.classList).toContain('stage-active');
    expect(fact(copying, 'Staged at')).toBe('/srv/staging/tor-1');
    expect(fact(copying, 'Now copying')).toBe('episode-03.mkv');
    expect(fact(copying, 'Into')).toBe('/macha/shows/some-release/episode-03.mkv');
    expect(stage('download').classList).toContain('stage-done');
  });

  it('says a torrent that has gone is gone, rather than showing an empty page', async () => {
    renderAt('/ingest/torrents/nope', snapshot([torrentJob()]));
    await waitFor(() => expect(screen.getByText('This torrent is no longer on the server.')).not.toBeNull());
  });
});

describe('each kind of import on its own page', () => {
  const copying: IngestJob = { ...importing, id: 'ing-2', source_type: 'filesystem', source_ref: '/media/usb/Movies', display_name: 'Movies' };

  it('shows torrents and their magnet form on the torrents page, and no file imports', async () => {
    renderAt('/ingest/torrents', snapshot([torrentJob()], [copying]));
    await screen.findByText('Some.Release.2024.1080p');
    expect(screen.getByLabelText('Magnet link')).toBeTruthy();
    expect(screen.queryByLabelText('Server file or folder path')).toBeNull();
    expect(screen.queryByRole('table', { name: /file and folder imports/i })).toBeNull();
  });

  it('shows file imports and their path form on the files page, and no torrents', async () => {
    renderAt('/ingest/files', snapshot([torrentJob()], [copying]));
    await screen.findByRole('table', { name: /file and folder imports/i });
    expect(screen.getByLabelText('Server file or folder path')).toBeTruthy();
    expect(screen.queryByLabelText('Magnet link')).toBeNull();
    expect(screen.queryByText('Some.Release.2024.1080p')).toBeNull();
  });
});

describe('a long torrent list', () => {
  it('shows fifty rows a page, and keeps the page in the address', async () => {
    const many = Array.from({ length: 60 }, (_, index) => torrentJob({ id: `t${index}`, name: `Torrent ${String(index).padStart(2, '0')}`, created_unix_ms: 1_000 + index }));
    renderAt('/ingest/torrents', snapshot(many));
    await screen.findByText('Torrent 59');
    expect(document.querySelectorAll('.torrent-table tbody tr')).toHaveLength(50);
    expect(screen.getByText('1–50 of 60 · page 1 of 2')).toBeTruthy();

    // Looked up inside the pager: a role query over the whole page computes
    // an accessible name for every control in fifty rows, which is what took
    // this test past five seconds on a loaded machine.
    fireEvent.click(within(document.querySelector('.pager') as HTMLElement).getByRole('button', { name: 'Next' }));
    await screen.findByText('Torrent 09');
    expect(document.querySelectorAll('.torrent-table tbody tr')).toHaveLength(10);
    expect(screen.getByTestId('where').textContent).toBe('/ingest/torrents?sort=added&dir=desc&page=2');
  });
});

describe('bulk actions on torrents', () => {
  const tick = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }));
  const bar = () => screen.getByRole('group', { name: 'Selected torrent actions' });

  it('pauses only the ticked torrents that can pause, and lets go of one that has gone', async () => {
    const running = torrentJob({ id: 'a', name: 'Alpha' });
    const paused = torrentJob({ id: 'b', name: 'Bravo', state: 'paused' });
    const other = torrentJob({ id: 'c', name: 'Charlie' });
    let current = snapshot([running, paused, other]);
    const pauseTorrent = vi.fn(async (id: string) => {
      current = snapshot([running, other]);
      return torrentJob({ id, state: 'paused' });
    });
    renderAt('/ingest/torrents', current, fakeApi(() => current, { pauseTorrent }));
    await screen.findByText('Alpha');
    expect(screen.queryByRole('group', { name: 'Selected torrent actions' })).toBeNull();

    tick('Alpha');
    tick('Bravo');
    expect(within(bar()).getByText('2 selected')).toBeTruthy();
    expect((within(bar()).getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Pause' }));

    await waitFor(() => expect(within(bar()).getByText('1 selected')).toBeTruthy());
    expect(pauseTorrent.mock.calls).toEqual([['a']]);
  });

  it('says how many the server refused', async () => {
    const pauseTorrent = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('refused');
      return torrentJob({ id, state: 'paused' });
    });
    const value = snapshot([torrentJob({ id: 'a', name: 'Alpha' }), torrentJob({ id: 'b', name: 'Bravo' })]);
    renderAt('/ingest/torrents', value, fakeApi(value, { pauseTorrent }));
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select this page' }));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Pause' }));
    expect((await screen.findByRole('alert')).textContent).toBe('1 of 2 torrents could not be paused.');
  });

  it('asks before removing, cancels those still running, and clears them all', async () => {
    const cancelTorrent = vi.fn(async (id: string) => torrentJob({ id, state: 'cancelled' }));
    const clearTorrent = vi.fn(async (_id: string) => undefined);
    const value = snapshot([torrentJob({ id: 'a', name: 'Alpha' }), torrentJob({ id: 'd', name: 'Delta', state: 'completed' })]);
    renderAt('/ingest/torrents', value, fakeApi(value, { cancelTorrent, clearTorrent }));
    await screen.findByText('Alpha');
    tick('Alpha');
    tick('Delta');
    fireEvent.click(within(bar()).getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove 2 torrents?' });
    expect(clearTorrent).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Selected torrent actions' })).toBeNull());
    expect(cancelTorrent.mock.calls).toEqual([['a']]);
    expect(clearTorrent.mock.calls.map(([id]) => id).sort()).toEqual(['a', 'd']);
  });
});

describe('refreshing the torrent list', () => {
  it('sits last in the add row, after Add torrent, and spins while a refresh it asked for is loading', async () => {
    const value = snapshot([torrentJob()]);
    let release: (() => void) | undefined;
    let calls = 0;
    const api = fakeApi(value, {
      snapshot: () => {
        calls += 1;
        // The first answer arrives at once; the viewer's refresh waits until released.
        return calls === 1 ? Promise.resolve(value) : new Promise<AcquisitionSnapshot>((resolve) => { release = () => resolve(value); });
      },
    });
    renderAt('/ingest/torrents', value, api);
    await screen.findByText('Some.Release.2024.1080p');

    const form = screen.getByLabelText('Magnet link').closest('form') as HTMLFormElement;
    const buttons = within(form).getAllByRole('button');
    expect(buttons.map((button) => button.textContent || button.getAttribute('aria-label'))).toEqual(['Add torrent', 'Refresh torrents']);

    fireEvent.click(within(form).getByRole('button', { name: 'Refresh torrents' }));
    const busy = await within(form).findByRole('button', { name: 'Refresh torrents in progress' });
    expect(busy.querySelector('.button-spinner')).toBeTruthy();
    expect(calls).toBe(2);

    release?.();
    await within(form).findByRole('button', { name: 'Refresh torrents' });
    expect(form.querySelector('.button-spinner')).toBeNull();
  });

  it('spins while the list is first loading', async () => {
    const value = snapshot([torrentJob()]);
    renderAt('/ingest/torrents', value, fakeApi(value, { snapshot: () => new Promise<AcquisitionSnapshot>(() => undefined) }));
    expect(await screen.findByRole('button', { name: 'Refresh torrents in progress' })).toBeTruthy();
  });
});
