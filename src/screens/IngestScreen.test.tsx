// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endpointFailure, MachaAcquisitionApiError, type AcquisitionApi, type AcquisitionSnapshot, type IngestJob, type TorrentJob } from '@machafoundation/core';
import { IngestScreen } from './IngestScreen';
import { TorrentDetailScreen } from './TorrentDetailScreen';
import { settle } from '../test/settle';

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
    // An opaque hash, as the server reports node ids; not a host name.
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
    ingestSources: [],
    torrentSources: [],
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
    // One node that runs torrents.
    torrentNodes: () => Promise.resolve({ nodes: [{ node_id: 'gbni', host: 'gbni-1', local: false, reachable: true, as_of_unix_ms: 1, max_active: 4, active_jobs: 0, accepting: true, not_accepting_reason: null, staging: { limit_bytes: 1, disk_bytes: 1, reserved_bytes: 0, free_bytes: 1 } }] }),
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

// The list polls every 1.5 s; faking the interval keeps outcomes independent of
// machine speed. The settle helper's zero-delay timer stays real.
beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); });
afterEach(() => { vi.useRealTimers(); });

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
  await settle();
  const table = screen.getByRole('table', { name: /torrents/i });
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
    await settle();
    screen.getByText('Alpha');
    expect(await rowNames()).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(document.querySelectorAll('.torrent-table tbody tr')).toHaveLength(3);
  });

  it('reorders when the viewer picks a sort, and says so in the address', async () => {
    renderAt('/ingest/torrents', snapshot(three));
    await settle();
    screen.getByText('Alpha');
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'name' } });
    expect(await rowNames()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(screen.getByTestId('where').textContent).toBe('/ingest/torrents?sort=name&dir=asc');

    fireEvent.click(screen.getByRole('button', { name: /Ascending; switch to descending/ }));
    expect(await rowNames()).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it('sorts from a column header, and reverses on a second press', async () => {
    renderAt('/ingest/torrents', snapshot(three));
    await settle();
    screen.getByText('Alpha');
    const header = within(document.querySelector('.torrent-table thead') as HTMLElement).getByRole('button', { name: /Down/ });
    fireEvent.click(header);
    expect(await rowNames()).toEqual(['Bravo', 'Charlie', 'Alpha']);
    fireEvent.click(header);
    expect(await rowNames()).toEqual(['Alpha', 'Charlie', 'Bravo']);
  });

  it('opens a torrent on its own page, keeping the sort for the way back', async () => {
    renderAt('/ingest/torrents?sort=name&dir=desc', snapshot(three));
    await settle();
    fireEvent.click(screen.getByRole('link', { name: 'Alpha' }));
    expect(screen.getByTestId('where').textContent).toBe('/ingest/torrents/a?sort=name&dir=desc');
    await settle();
    fireEvent.click(screen.getByRole('link', { name: '← Torrents' }));
    expect(screen.getByTestId('where').textContent).toBe('/ingest/torrents?sort=name&dir=desc');
  });

  it('keeps the detail off the list', async () => {
    renderAt('/ingest/torrents', snapshot([torrentJob()]));
    await settle();
    screen.getByText('Some.Release.2024.1080p');
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

  it('names the node each torrent is downloading on, by host, and none while no node has claimed it', async () => {
    renderAt('/ingest/torrents', snapshot([
      torrentJob({ id: 'tor-1', node_id: 'gbni' }),
      torrentJob({ id: 'tor-2', node_id: null, name: 'Waiting.One' }),
      torrentJob({ id: 'tor-3', node_id: 'gbni', ingest_node_id: 'fi-node', name: 'Importing.Elsewhere' }),
    ]));
    await settle();
    const nodes = [...document.querySelectorAll('tbody td.col-node')].map((cell) => cell.textContent);
    // A node the list does not name is shown by the start of its id.
    expect(nodes.sort()).toEqual(['-', 'gbni-1', 'gbni-1 → Node fi-node']);
  });

  it('reports the facts the list has no room for: hash, node, ratio and cataloguing outcome', async () => {
    renderAt('/ingest/torrents/tor-1', snapshot([torrentJob({ node_id: 'gbni' })]));
    await settle();
    screen.getByRole('heading', { name: 'Some.Release.2024.1080p' });
    const identity = document.querySelector('.detail-card')!;

    expect(fact(identity, 'Info hash')).toBe('c2a1f0e9b8d7c6b5a4938271605f4e3d2c1b0a99');
    // By host, as the node list names it.
    expect(fact(identity, 'Node')).toBe('gbni-1');
    expect(fact(identity, 'Importing on')).toBeUndefined();
    // 250 MB served against the 1 GB this node actually holds.
    expect(tile('Ratio')).toBe('0.25');
    expect(tile('Added')).toBe('1h ago');
    // Downloaded cleanly but only partly catalogued: the counts are the only tell.
    const catalogue = stage('catalogue');
    expect(catalogue.querySelector('.torrent-stage-status')?.textContent).toBe('Completed with issues');
    expect(fact(catalogue, 'Catalogued')).toBe('1 / 2');
    expect(fact(catalogue, 'No match')).toBe('1');
  });

  it('names the node importing a torrent, and its swarm, on its page', async () => {
    renderAt('/ingest/torrents/tor-1', snapshot([torrentJob({ node_id: 'gbni', ingest_node_id: 'gbni', swarm: { seeds: 3, peers: 12, availability: 0.82 } })]));
    await settle();
    const identity = document.querySelector('.detail-card')!;
    expect(fact(identity, 'Importing on')).toBe('gbni-1');
    expect(fact(identity, 'Swarm')).toBe('0.82 available · 3 seeds · 12 peers');
  });

  it('shows the import as still to come for a torrent that has not been handed to ingest', async () => {
    renderAt('/ingest/torrents/tor-1', snapshot([torrentJob()]));
    await settle();
    screen.getByRole('heading', { name: 'Import' });
    expect(stage('import').classList).toContain('stage-waiting');
    expect(fact(stage('import'), 'Staged at')).toBeUndefined();
  });

  it('reports the linked import job once the payload is being copied in', async () => {
    renderAt('/ingest/torrents/tor-1', snapshot([torrentJob({ ingest_job_id: 'ing-1' })], [importing]));
    await settle();
    screen.getByRole('heading', { name: 'Import' });
    const copying = stage('import');
    expect(copying.classList).toContain('stage-active');
    expect(fact(copying, 'Staged at')).toBe('/srv/staging/tor-1');
    expect(fact(copying, 'Now copying')).toBe('episode-03.mkv');
    expect(fact(copying, 'Into')).toBe('/macha/shows/some-release/episode-03.mkv');
    expect(stage('download').classList).toContain('stage-done');
  });

  it('says a torrent that has gone is gone, rather than showing an empty page', async () => {
    renderAt('/ingest/torrents/nope', snapshot([torrentJob()]));
    await settle();
    expect(screen.getByText('This torrent is no longer on the server.')).not.toBeNull();
  });
});

describe('each kind of import on its own page', () => {
  const copying: IngestJob = { ...importing, id: 'ing-2', source_type: 'filesystem', source_ref: '/media/usb/Movies', display_name: 'Movies' };

  it('shows torrents and their magnet form on the torrents page, and no file imports', async () => {
    renderAt('/ingest/torrents', snapshot([torrentJob()], [copying]));
    await settle();
    screen.getByText('Some.Release.2024.1080p');
    expect(screen.getByLabelText('Magnet link')).toBeTruthy();
    expect(screen.queryByLabelText('Server file or folder path')).toBeNull();
    expect(screen.queryByRole('table', { name: /file and folder imports/i })).toBeNull();
  });

  it('shows file imports and their path form on the files page, and no torrents', async () => {
    renderAt('/ingest/files', snapshot([torrentJob()], [copying]));
    await settle();
    screen.getByRole('table', { name: /file and folder imports/i });
    expect(screen.getByLabelText('Server file or folder path')).toBeTruthy();
    expect(screen.queryByLabelText('Magnet link')).toBeNull();
    expect(screen.queryByText('Some.Release.2024.1080p')).toBeNull();
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
    await settle();
    screen.getByText('Alpha');
    expect(screen.queryByRole('group', { name: 'Selected torrent actions' })).toBeNull();

    tick('Alpha');
    tick('Bravo');
    expect(within(bar()).getByText('2 selected')).toBeTruthy();
    expect((within(bar()).getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Pause' }));

    await settle();
    expect(within(bar()).getByText('1 selected')).toBeTruthy();
    expect(pauseTorrent.mock.calls).toEqual([['a']]);
  });

  it('says how many the server refused', async () => {
    const pauseTorrent = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('refused');
      return torrentJob({ id, state: 'paused' });
    });
    const value = snapshot([torrentJob({ id: 'a', name: 'Alpha' }), torrentJob({ id: 'b', name: 'Bravo' })]);
    renderAt('/ingest/torrents', value, fakeApi(value, { pauseTorrent }));
    await settle();
    screen.getByText('Alpha');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select this page' }));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Pause' }));
    await settle();
    expect((screen.getByRole('alert')).textContent).toBe('1 of 2 torrents could not be paused.');
  });

  it('asks before removing, cancels those still running, and clears them all', async () => {
    const cancelTorrent = vi.fn(async (id: string) => torrentJob({ id, state: 'cancelled' }));
    const clearTorrent = vi.fn(async (_id: string) => undefined);
    const value = snapshot([torrentJob({ id: 'a', name: 'Alpha' }), torrentJob({ id: 'd', name: 'Delta', state: 'completed' })]);
    renderAt('/ingest/torrents', value, fakeApi(value, { cancelTorrent, clearTorrent }));
    await settle();
    screen.getByText('Alpha');
    tick('Alpha');
    tick('Delta');
    fireEvent.click(within(bar()).getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove 2 torrents?' });
    expect(clearTorrent).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await settle();
    expect(screen.queryByRole('group', { name: 'Selected torrent actions' })).toBeNull();
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
    await settle();
    screen.getByText('Some.Release.2024.1080p');

    const form = screen.getByLabelText('Magnet link').closest('form') as HTMLFormElement;
    const buttons = within(form).getAllByRole('button');
    expect(buttons.map((button) => button.textContent || button.getAttribute('aria-label'))).toEqual(['Add torrent', 'Refresh torrents']);

    fireEvent.click(within(form).getByRole('button', { name: 'Refresh torrents' }));
    await settle();
    const busy = within(form).getByRole('button', { name: 'Refresh torrents in progress' });
    expect(busy.querySelector('.button-spinner')).toBeTruthy();
    expect(calls).toBe(2);

    release?.();
    await settle();
    within(form).getByRole('button', { name: 'Refresh torrents' });
    expect(form.querySelector('.button-spinner')).toBeNull();
  });

  it('spins while the list is first loading', async () => {
    const value = snapshot([torrentJob()]);
    renderAt('/ingest/torrents', value, fakeApi(value, { snapshot: () => new Promise<AcquisitionSnapshot>(() => undefined) }));
    await settle();
    expect(screen.getByRole('button', { name: 'Refresh torrents in progress' })).toBeTruthy();
  });
});

describe('adding a torrent the node already holds (server 0.63.0)', () => {
  it('says so and offers the job that holds it, through the router\'s wrapping', async () => {
    const refusal = new MachaAcquisitionApiError('m', 409, 'torrent_already_added', 'job tor-1 already holds this torrent', undefined, { id: 'tor-1', nodeId: 'n1' });
    const api = fakeApi(snapshot([torrentJob()]), { submitMagnet: () => Promise.reject(endpointFailure('e', 'http://node', refusal)) });
    renderAt('/ingest/torrents', snapshot([torrentJob()]), api);
    await settle();
    screen.getByText('Some.Release.2024.1080p');
    fireEvent.change(screen.getByLabelText('Magnet link'), { target: { value: 'magnet:?xt=urn:btih:c2a1f0e9b8d7c6b5a4938271605f4e3d2c1b0a99' } });
    fireEvent.click(screen.getByText('Add torrent'));
    await settle();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('That torrent is already in the list. To download it again, remove its job first.');
    fireEvent.click(within(alert).getByText('Open it'));
    // Wait for the route: the click can land before the navigation renders.
    await settle();
    expect(screen.getByTestId('where').textContent).toContain('/ingest/torrents/tor-1');
  });
});

describe('adding a torrent to the cluster (server 0.64.0)', () => {
  const capable = { node_id: 'gbni', host: 'gbni-1', local: false, reachable: true, as_of_unix_ms: 1, max_active: 4, active_jobs: 0, accepting: true, not_accepting_reason: null, staging: { limit_bytes: 1, disk_bytes: 1, reserved_bytes: 0, free_bytes: 1 } };

  it('takes an add on a node without torrents when the cluster has a node that does, pinned and with a removal time', async () => {
    const submitMagnet = vi.fn(async () => ({ id: 'new', infoHash: null, pinnedNodeId: 'gbni' }));
    const withoutTorrents = { ...snapshot([torrentJob()]), torrentStatus: { enabled: false, build_available: false, search_enabled: false } };
    const api = fakeApi(withoutTorrents, { submitMagnet, torrentNodes: () => Promise.resolve({ nodes: [capable], defaultRemoveAfterMs: null }) } as Partial<AcquisitionApi>);
    renderAt('/ingest/torrents', withoutTorrents, api);
    await settle();
    const node = screen.getByLabelText('Download on') as HTMLSelectElement;
    expect(screen.queryByText(/built without libtorrent/)).toBeNull();
    expect([...node.options].map((option) => option.textContent)).toEqual(['Any node', 'gbni-1 (0 of 4 running · 1 B free of 1 B)']);
    fireEvent.change(node, { target: { value: 'gbni' } });
    fireEvent.change(screen.getByLabelText('Remove after completion'), { target: { value: '3600000' } });
    fireEvent.change(screen.getByLabelText('Magnet link'), { target: { value: 'magnet:?xt=urn:btih:abc' } });
    fireEvent.click(screen.getByText('Add torrent'));
    await settle();
    expect(submitMagnet).toHaveBeenCalledWith('magnet:?xt=urn:btih:abc', { nodeId: 'gbni', removeAfterMs: 3_600_000 });
  });

  it('leaves the node and removal to the cluster unless the viewer chooses', async () => {
    const submitMagnet = vi.fn(async () => ({ id: 'new', infoHash: null, pinnedNodeId: null }));
    const api = fakeApi(snapshot([torrentJob()]), { submitMagnet, torrentNodes: () => Promise.resolve({ nodes: [capable], defaultRemoveAfterMs: null }) } as Partial<AcquisitionApi>);
    renderAt('/ingest/torrents', snapshot([torrentJob()]), api);
    await settle();
    screen.getByLabelText('Download on');
    expect((screen.getByLabelText('Remove after completion') as HTMLSelectElement).options[0]!.textContent).toBe('Keep it (the default)');
    fireEvent.change(screen.getByLabelText('Magnet link'), { target: { value: 'magnet:?xt=urn:btih:abc' } });
    fireEvent.click(screen.getByText('Add torrent'));
    await settle();
    expect(submitMagnet).toHaveBeenCalledWith('magnet:?xt=urn:btih:abc', {});
  });

  it('shows an action still under way in the status column', async () => {
    renderAt('/ingest/torrents', snapshot([torrentJob({ desired: 'paused', desired_applied: false, desired_changed_unix_ms: Date.now() })]));
    await settle();
    expect(screen.getByText('Pausing…')).toBeTruthy();
  });
});

describe('a torrent added paused, waiting for a node', () => {
  it('reads as paused and offers Resume, not Pause', async () => {
    renderAt('/ingest/torrents', snapshot([torrentJob({ id: 'held', name: 'Held', state: 'awaiting_node', desired: 'paused', desired_applied: true })]));
    await settle();
    expect(screen.getByText('Paused, waiting for a node')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume Held' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause Held' })).toBeNull();
  });
});

describe('a download being stored in the cluster (server 0.71.0)', () => {
  const publication = { published_extents: 246, extents: 624, published_bytes: 1_031_798_784, bytes: 2_607_096_508, progress_age_ms: 2_000 };
  const storing = (progressAgeMs = 2_000) => torrentJob({ state: 'downloaded', progress: 1, waiting_reason: 'extent_publication', publication: { ...publication, progress_age_ms: progressAgeMs } });

  it('says so in the list, with how far it has got', async () => {
    renderAt('/ingest/torrents', snapshot([storing()]));
    await settle();
    expect(screen.getByText('Storing 39.4%')).toBeTruthy();
  });

  it('says in the list when it has stood still', async () => {
    renderAt('/ingest/torrents', snapshot([storing(4 * 60_000)]));
    await settle();
    expect(screen.getByText('Storing 39.4%, no progress for 4 min')).toBeTruthy();
  });

  it("shows it as the torrent's current stage, with what has been stored", async () => {
    renderAt('/ingest/torrents/tor-1', snapshot([storing()]));
    await settle();
    expect(document.querySelector('.torrent-hero-stage')?.textContent).toBe('Storing in the cluster');
    expect(screen.getByText('984 MB of 2.43 GB stored.')).toBeTruthy();
  });
});

describe('adding a torrent paused (server 0.71.0)', () => {
  const magnetLink = 'magnet:?xt=urn:btih:abc';
  function add(submitMagnet: AcquisitionApi['submitMagnet'], tickPaused: boolean) {
    const api = fakeApi(snapshot([torrentJob()]), { submitMagnet });
    renderAt('/ingest/torrents', snapshot([torrentJob()]), api);
    return async () => {
      await settle();
      if (tickPaused) fireEvent.click(screen.getByLabelText('Start paused'));
      fireEvent.change(screen.getByLabelText('Magnet link'), { target: { value: magnetLink } });
      fireEvent.click(screen.getByText('Add torrent'));
      await settle();
    };
  }

  it('asks for it held, and says it is waiting to be resumed', async () => {
    const submitMagnet = vi.fn(async () => ({ id: 'new', infoHash: null, pinnedNodeId: null, job: torrentJob({ id: 'new', desired: 'paused' }) }));
    await add(submitMagnet, true)();
    expect(submitMagnet).toHaveBeenCalledWith(magnetLink, { paused: true });
    expect(screen.getByText('Torrent queued, paused. Resume it in the list to start it.')).toBeTruthy();
  });

  it('asks nothing of the kind when the box is left alone', async () => {
    const submitMagnet = vi.fn(async () => ({ id: 'new', infoHash: null, pinnedNodeId: null }));
    await add(submitMagnet, false)();
    expect(submitMagnet).toHaveBeenCalledWith(magnetLink, {});
    expect(screen.getByText('Torrent queued.')).toBeTruthy();
  });

  it('says so when core had to pause it just after a server older than 0.71.0 started it', async () => {
    const submitMagnet = vi.fn(async () => ({ id: 'new', infoHash: null, pinnedNodeId: null, pausedAfterAdd: true, job: torrentJob({ id: 'new', desired: 'paused' }) }));
    await add(submitMagnet, true)();
    expect(screen.getByText('Torrent queued, paused. It started for a moment first: this server cannot add a torrent paused yet.')).toBeTruthy();
  });

  it('says it is running when the pause core tried after the add failed', async () => {
    const submitMagnet = vi.fn(async () => ({
      id: 'new', infoHash: null, pinnedNodeId: null, pausedAfterAdd: false, pauseError: new Error('500'),
      job: torrentJob({ id: 'new', desired: 'active' }),
    }));
    await add(submitMagnet, true)();
    expect(screen.getByText('Torrent queued, but this server started it: it cannot add a torrent paused yet. Pause it in the list.')).toBeTruthy();
  });

  it('never claims a pause a server older than 0.71.0 ignored', async () => {
    const submitMagnet = vi.fn(async () => ({ id: 'new', infoHash: null, pinnedNodeId: null, job: torrentJob({ id: 'new', desired: 'active' }) }));
    await add(submitMagnet, true)();
    expect(screen.getByText('Torrent queued, but this server started it: it cannot add a torrent paused yet. Pause it in the list.')).toBeTruthy();
  });
});

describe('whether torrents can be added, from the cluster not the node that answered (server 0.64.0)', () => {
  const noTorrentsHere = () => ({ ...snapshot([torrentJob()]), torrentStatus: { enabled: false, build_available: false, search_enabled: false } });

  it('says nothing about the answering node while the cluster\'s nodes are still loading', async () => {
    const api = fakeApi(noTorrentsHere(), { torrentNodes: () => new Promise(() => {}) } as Partial<AcquisitionApi>);
    renderAt('/ingest/torrents', noTorrentsHere(), api);
    await settle();
    screen.getByText('Some.Release.2024.1080p');
    expect(screen.queryByText(/built without libtorrent|disabled in server configuration|No node in this cluster/)).toBeNull();
  });

  it('says so when no node in the cluster can download torrents', async () => {
    const api = fakeApi(noTorrentsHere(), { torrentNodes: () => Promise.resolve({ nodes: [] }) } as Partial<AcquisitionApi>);
    renderAt('/ingest/torrents', noTorrentsHere(), api);
    await settle();
    expect(screen.getByText('No node in this cluster can download torrents.')).toBeTruthy();
    expect((screen.getByLabelText('Magnet link') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText(/built without libtorrent/)).toBeNull();
  });

  it('keeps the answering node\'s word on a server older than 0.64.0, which has no node list', async () => {
    const api = fakeApi(noTorrentsHere(), { torrentNodes: () => Promise.reject(new Error('404')) } as Partial<AcquisitionApi>);
    renderAt('/ingest/torrents', noTorrentsHere(), api);
    await settle();
    expect(screen.getByText('This server was built without libtorrent-rasterbar.')).toBeTruthy();
  });
});
