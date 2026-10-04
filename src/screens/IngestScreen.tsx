import { useMemo, useState, type ChangeEvent, type FormEvent, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { routes, torrentHeldBy, type AcquisitionApi, type IngestJob, type TorrentJob } from '@machafoundation/core';
import { JobControls, Progress } from './ingest/JobControls';
import { intentNote, REMOVE_AFTER_CHOICES, staleSourceNotes, removeAfterDefaultLabel, torrentNodeLabel } from './ingest/clusterTorrents';
import { useAsync } from '../hooks/useAsync';
import { formatAge, formatBytes, formatCount, formatEta, formatPercent, formatRate, formatRatio, formatTimestamp, percent, stateLabel } from './ingest/format';
import { canPause, canResume, canRetryImport, displayStateOf, heldStatus, jobKey, linkedIngestOf, storingOf, storingPercent, storingStallText } from './ingest/jobs';
import { DEFAULT_TORRENT_SORT, sortTorrents, TORRENT_SORT_KEYS } from './ingest/torrentSort';
import { SortControl, SortHeader, useListSort } from '../components/ListSortControls';
import { BulkActions, ListHeading, Pager, SelectPageBox, SelectRowBox, useListSelection } from '../components/ListParts';
import { ConfirmModal } from '../components/Modal';
import { AsyncIconButton } from '../components/AsyncIconButton';
import { RefreshIcon } from '../components/ManageIcons';
import { pageSlice } from '../lists/paging';
import { useAcquisition } from './ingest/useAcquisition';
import { jobErrorText, viewerErrorText } from '../text/viewerText';

/** Import's pages: torrents and filesystem imports. */
export type IngestSection = 'torrents' | 'files';

interface Props {
  api: AcquisitionApi;
  section: IngestSection;
}

/** A torrent's own page, carrying the list's sort so coming back lands on the same order. */
export function torrentPath(id: string, search = ''): string {
  return `${routes.ingestTorrent(id)}${search}`;
}

/** The list's status while the download is stored in the cluster: "Storing 40%". */
function storingStatus(job: TorrentJob): string | undefined {
  const storing = storingOf(job);
  if (!storing) return undefined;
  const stall = storingStallText(storing);
  return `Storing ${formatPercent(storingPercent(storing) ?? null)}${stall ? `, ${stall}` : ''}`;
}

export function IngestScreen({ api, section }: Props) {
  const acquisition = useAcquisition(api);
  const { snapshot, loading, error, setError, notice, setNotice, refresh, busyByJob, confirmRemove, setConfirmRemove, act, actMany } = acquisition;
  const [path, setPath] = useState('');
  const [magnet, setMagnet] = useState('');
  // Added held, so nothing is checked or downloaded until resumed.
  const [startPaused, setStartPaused] = useState(false);
  const [submitting, setSubmitting] = useState<'path' | 'magnet'>();
  const [refreshing, setRefreshing] = useState(false);
  const navigate = useNavigate();
  // The job already holding a torrent the viewer tried to add again, to link to it.
  const [heldBy, setHeldBy] = useState<string | undefined>(undefined);
  // '' is "any node" and "the cluster default".
  const torrentNodes = useAsync(() => section === 'torrents' ? api.torrentNodes() : Promise.resolve(undefined), [api, section]);
  const [nodeChoice, setNodeChoice] = useState('');
  const [removeAfter, setRemoveAfter] = useState('');
  const { sort, setSort, sortBy, page, setPage, search } = useListSort(TORRENT_SORT_KEYS, DEFAULT_TORRENT_SORT);

  const filesystemJobs = useMemo(
    () => (snapshot?.ingestJobs.filter((job) => job.source_type !== 'torrent') ?? [])
      .slice()
      .sort((left, right) => right.created_unix_ms - left.created_unix_ms || (left.id < right.id ? -1 : 1)),
    [snapshot?.ingestJobs],
  );
  // Keyed on the sort's fields: the object is rebuilt on every render.
  const { key: sortKey, direction: sortDirection } = sort;
  const torrentJobs = useMemo(
    () => sortTorrents(
      snapshot?.torrentJobs ?? [],
      { key: sortKey, direction: sortDirection },
      (job) => displayStateOf(job, linkedIngestOf(job, snapshot?.ingestJobs)),
    ),
    [snapshot?.torrentJobs, snapshot?.ingestJobs, sortKey, sortDirection],
  );

  const torrentPage = pageSlice(torrentJobs, page);
  const selection = useListSelection(torrentJobs);
  const selected = torrentJobs.filter((job) => selection.checked.has(job.id));
  const pausable = selected.filter((job) => canPause('torrent', job.state, job.desired));
  const resumable = selected.filter((job) => canResume('torrent', job.state, job.desired));
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkRemove, setConfirmBulkRemove] = useState(false);

  const bulk = async (jobs: readonly TorrentJob[], action: 'pause' | 'resume' | 'remove') => {
    setBulkBusy(true);
    const succeeded = await actMany('torrent', jobs, action);
    if (action === 'remove') {
      setConfirmBulkRemove(false);
      if (succeeded) selection.clear();
    }
    setBulkBusy(false);
  };

  const submit = async (kind: 'path' | 'magnet', event: FormEvent) => {
    event.preventDefault();
    const value = (kind === 'path' ? path : magnet).trim();
    if (!value) return;
    if (kind === 'magnet' && !/^magnet:\?/i.test(value)) {
      setError('Enter a magnet link beginning with magnet:?.');
      return;
    }
    setSubmitting(kind);
    setError(undefined);
    setHeldBy(undefined);
    setNotice(undefined);
    try {
      if (kind === 'path') {
        await api.submitPath(value);
        setPath('');
        setNotice(`Import queued: ${value}`);
      } else {
        const added = await api.submitMagnet(value, {
          ...(nodeChoice ? { nodeId: nodeChoice } : {}),
          ...(removeAfter !== '' ? { removeAfterMs: Number(removeAfter) } : {}),
          ...(startPaused ? { paused: true } : {}),
        });
        setMagnet('');
        // A node older than 0.71.0 starts the job regardless and core pauses it at once
        // (`pausedAfterAdd`); a job still not paused is never called paused.
        setNotice(!startPaused ? 'Torrent queued.'
          : added.job && added.job.desired !== 'paused'
            ? 'Torrent queued, but this server started it: it cannot add a torrent paused yet. Pause it in the list.'
            : added.pausedAfterAdd
              ? 'Torrent queued, paused. It started for a moment first: this server cannot add a torrent paused yet.'
              : 'Torrent queued, paused. Resume it in the list to start it.');
      }
      await refresh();
    } catch (reason: unknown) {
      setError(viewerErrorText(reason));
      setHeldBy(torrentHeldBy(reason)?.id);
    } finally {
      setSubmitting(undefined);
    }
  };

  /** A refresh the viewer asked for; the quiet poll does not spin the button. */
  const refreshNow = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } catch (reason: unknown) {
      setError(viewerErrorText(reason));
    } finally {
      setRefreshing(false);
    }
  };

  const ingestEnabled = snapshot?.ingestStatus.enabled ?? false;
  // Any node takes adds and /torrents/status describes only the answering node, so
  // availability is the cluster's node list. A server older than 0.64.0 has no list;
  // there the answering node's status decides.
  const clusterAnswered = torrentNodes.value !== undefined;
  const clusterTakesTorrents = (torrentNodes.value?.nodes.length ?? 0) > 0;
  const beforeClusterTorrents = Boolean(torrentNodes.error);
  const torrentEnabled = beforeClusterTorrents ? snapshot?.torrentStatus.enabled ?? false : clusterTakesTorrents;
  const torrentBuilt = snapshot?.torrentStatus.build_available ?? false;
  const now = Date.now();
  const refreshIntervalMs = snapshot?.refreshIntervalMs ?? 5_000;
  const staleNotes = staleSourceNotes(
    (section === 'torrents' ? snapshot?.torrentSources : snapshot?.ingestSources) ?? [],
    new Map(torrentNodes.value?.nodes.map((node) => [node.node_id, node.host]) ?? []),
    now,
  );

  /** The whole row opens the torrent, except where a control inside it was the target. */
  const openRow = (event: MouseEvent<HTMLTableRowElement>, job: TorrentJob) => {
    if ((event.target as HTMLElement).closest('button, a, input, select')) return;
    navigate(torrentPath(job.id, search));
  };

  return (
    <section className="ingest-screen">
      <header className="ingest-header">
        <h1>Import</h1>
      </header>

      <div className="ingest-add-bar">
        {section === 'torrents' ? (
          <form className="ingest-add-form" onSubmit={(event) => { void submit('magnet', event); }}>
            <input
              data-tv-focusable="true"
              aria-label="Magnet link"
              value={magnet}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setMagnet(event.target.value)}
              placeholder="magnet:?xt=urn:btih:…"
              disabled={!torrentEnabled || submitting === 'magnet'}
            />
            {clusterTakesTorrents && (
              <select aria-label="Download on" data-tv-focusable="true" value={nodeChoice} onChange={(event) => setNodeChoice(event.target.value)} disabled={submitting === 'magnet'}>
                <option value="">Any node</option>
                {torrentNodes.value?.nodes.map((node) => <option key={node.node_id} value={node.node_id}>{torrentNodeLabel(node)}</option>)}
              </select>
            )}
            {clusterTakesTorrents && (
              <select aria-label="Remove after completion" data-tv-focusable="true" value={removeAfter} onChange={(event) => setRemoveAfter(event.target.value)} disabled={submitting === 'magnet'}>
                <option value="">{removeAfterDefaultLabel(torrentNodes.value?.defaultRemoveAfterMs)}</option>
                {REMOVE_AFTER_CHOICES.map((choice) => <option key={choice.ms} value={String(choice.ms)}>{`Remove ${choice.label.charAt(0).toLowerCase()}${choice.label.slice(1)}`}</option>)}
              </select>
            )}
            <label className="ingest-start-paused">
              <input
                type="checkbox"
                data-tv-focusable="true"
                checked={startPaused}
                onChange={(event) => setStartPaused(event.target.checked)}
                disabled={!torrentEnabled || submitting === 'magnet'}
              />
              <span>Start paused</span>
            </label>
            <button className="primary-button" data-tv-focusable="true" type="submit" disabled={!torrentEnabled || !magnet.trim() || Boolean(submitting)}>
              {submitting === 'magnet' ? 'Adding…' : 'Add torrent'}
            </button>
            <AsyncIconButton label="Refresh torrents" busy={refreshing || (loading && !snapshot)} onClick={() => void refreshNow()} icon={<RefreshIcon />} />
          </form>
        ) : (
          <form className="ingest-add-form" onSubmit={(event) => { void submit('path', event); }}>
            <input
              data-tv-focusable="true"
              aria-label="Server file or folder path"
              title="A path on the Macha server, for example a mounted USB disk. Sources are preserved after a manual import."
              value={path}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPath(event.target.value)}
              placeholder="/media/usb/Movies"
              disabled={!ingestEnabled || submitting === 'path'}
            />
            <button className="primary-button" data-tv-focusable="true" type="submit" disabled={!ingestEnabled || !path.trim() || Boolean(submitting)}>
              {submitting === 'path' ? 'Adding…' : 'Import path'}
            </button>
          </form>
        )}
      </div>
      {section === 'torrents' && clusterAnswered && !clusterTakesTorrents && <p className="ingest-disabled-note">No node in this cluster can download torrents.</p>}
      {section === 'torrents' && beforeClusterTorrents && snapshot && !torrentBuilt && <p className="ingest-disabled-note">This server was built without libtorrent-rasterbar.</p>}
      {section === 'torrents' && beforeClusterTorrents && snapshot && torrentBuilt && !torrentEnabled && <p className="ingest-disabled-note">Torrent acquisition is disabled in server configuration.</p>}
      {section === 'files' && snapshot && !ingestEnabled && <p className="ingest-disabled-note">Filesystem import is disabled in server configuration.</p>}

      {error && <p className="ingest-page-error" role="alert">{error}{heldBy && <> <Link data-tv-focusable="true" to={torrentPath(heldBy)}>Open it</Link></>}</p>}
      {notice && <p className="ingest-page-notice">{notice}</p>}
      {staleNotes.map((note) => <p key={note} className="ingest-page-notice ingest-stale-source">{note}</p>)}
      {loading && !snapshot && <p className="ingest-loading">Loading import state…</p>}

      {section === 'torrents' && (
      <section className="ingest-job-section" aria-labelledby="ingest-torrents-heading">
        <ListHeading id="ingest-torrents-heading" title="Torrents" count={torrentJobs.length}>
          <SortControl keys={TORRENT_SORT_KEYS} sort={sort} onChange={setSort} />
        </ListHeading>
        <BulkActions label="Selected torrent actions" selection={selection} disabled={bulkBusy}>
          <button className="secondary-button" type="button" disabled={bulkBusy || pausable.length === 0} onClick={() => void bulk(pausable, 'pause')} data-tv-focusable="true">Pause</button>
          <button className="secondary-button" type="button" disabled={bulkBusy || resumable.length === 0} onClick={() => void bulk(resumable, 'resume')} data-tv-focusable="true">Resume</button>
          <button className="secondary-button ingest-delete-button" type="button" disabled={bulkBusy} onClick={() => setConfirmBulkRemove(true)} data-tv-focusable="true">Remove</button>
        </BulkActions>
        {snapshot && torrentJobs.length === 0 ? <p className="list-empty">No torrent jobs.</p> : (
          <div className="data-table-scroll">
            <table className="data-table torrent-table" aria-labelledby="ingest-torrents-heading">
              <thead>
                <tr>
                  <th scope="col" className="col-check">
                    <SelectPageBox ids={torrentPage.items.map((job) => job.id)} selection={selection} disabled={bulkBusy} />
                  </th>
                  <SortHeader label="Name" sortKey="name" sort={sort} onSort={sortBy} className="col-name" />
                  <SortHeader label="Size" sortKey="size" sort={sort} onSort={sortBy} className="col-size" />
                  <SortHeader label="Progress" sortKey="progress" sort={sort} onSort={sortBy} className="col-progress" />
                  <SortHeader label="Status" sortKey="status" sort={sort} onSort={sortBy} className="col-status" />
                  <SortHeader label="Down" sortKey="down" sort={sort} onSort={sortBy} className="col-rate" />
                  <SortHeader label="Up" sortKey="up" sort={sort} onSort={sortBy} className="col-rate col-optional" />
                  <SortHeader label="ETA" sortKey="eta" sort={sort} onSort={sortBy} className="col-eta" />
                  <th scope="col" className="col-peers col-optional">Seeds</th>
                  <th scope="col" className="col-peers col-optional">Peers</th>
                  <SortHeader label="Ratio" sortKey="ratio" sort={sort} onSort={sortBy} className="col-ratio col-optional" />
                  <SortHeader label="Added" sortKey="added" sort={sort} onSort={sortBy} className="col-added col-optional" />
                  <th scope="col" className="col-actions"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {torrentPage.items.map((job) => {
                  const linked = linkedIngestOf(job, snapshot?.ingestJobs);
                  const state = displayStateOf(job, linked);
                  const failure = jobErrorText(job) ?? jobErrorText(linked);
                  const progress = percent(job.progress, job.bytes_completed, job.bytes_total);
                  const name = job.name || 'Torrent';
                  return (
                    <tr key={job.id} className={`state-${state}${selection.checked.has(job.id) ? ' selected' : ''}`} onClick={(event) => openRow(event, job)}>
                      <td className="col-check">
                        <SelectRowBox id={job.id} name={name} selection={selection} disabled={bulkBusy} />
                      </td>
                      <td className="col-name">
                        <Link to={torrentPath(job.id, search)} data-tv-focusable="true" title={name}>{name}</Link>
                      </td>
                      <td className="col-size">{job.bytes_total !== null && job.bytes_total > 0 ? formatBytes(job.bytes_total) : '—'}</td>
                      <td className="col-progress">
                        <Progress value={progress} />
                        <span>{formatPercent(progress)}</span>
                      </td>
                      <td className={`col-status${failure ? ' has-error' : ''}`} title={failure}>{intentNote(job, now, refreshIntervalMs) ?? heldStatus(job) ?? storingStatus(job) ?? stateLabel(state)}</td>
                      <td className="col-rate">{formatRate(job.download_rate)}</td>
                      <td className="col-rate col-optional">{formatRate(job.upload_rate)}</td>
                      <td className="col-eta">{formatEta(job.eta_seconds)}</td>
                      <td className="col-peers col-optional">{formatCount(job.seeds)}</td>
                      <td className="col-peers col-optional">{formatCount(job.peers)}</td>
                      <td className="col-ratio col-optional">{formatRatio(job)}</td>
                      <td className="col-added col-optional" title={formatTimestamp(job.created_unix_ms)}>{formatAge(job.created_unix_ms, now)}</td>
                      <td className="col-actions">
                        <JobControls
                          variant="row"
                          kind="torrent"
                          id={job.id}
                          name={name}
                          state={job.state}
                          desired={job.desired}
                          retryable={canRetryImport(job, linked)}
                          busyAction={busyByJob[jobKey('torrent', job.id)]}
                          confirming={confirmRemove === jobKey('torrent', job.id)}
                          onAction={(action) => { void act('torrent', job.id, job.state, action); }}
                          onConfirm={setConfirmRemove}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager label="Torrent pages" {...torrentPage} total={torrentJobs.length} onPage={setPage} />
        <ConfirmModal
          open={confirmBulkRemove}
          title={selected.length === 1 ? 'Remove this torrent?' : `Remove ${selected.length} torrents?`}
          confirmLabel="Remove"
          destructive
          busy={bulkBusy}
          onCancel={() => setConfirmBulkRemove(false)}
          onConfirm={() => void bulk(selected, 'remove')}
        >
          <p>Any still downloading or seeding are cancelled first.</p>
        </ConfirmModal>
      </section>
      )}

      {section === 'files' && (
      <section className="ingest-job-section" aria-labelledby="ingest-files-heading">
        <ListHeading id="ingest-files-heading" title="File and folder imports" count={filesystemJobs.length} />
        {snapshot && filesystemJobs.length === 0 ? <p className="list-empty">No filesystem import jobs.</p> : (
          <div className="data-table-scroll">
            <table className="data-table" aria-labelledby="ingest-files-heading">
              <thead>
                <tr>
                  <th scope="col" className="col-name">Name</th>
                  <th scope="col" className="col-size">Copied</th>
                  <th scope="col" className="col-progress">Progress</th>
                  <th scope="col" className="col-status">Status</th>
                  <th scope="col" className="col-rate">Rate</th>
                  <th scope="col" className="col-eta">ETA</th>
                  <th scope="col" className="col-peers col-optional">Files</th>
                  <th scope="col" className="col-actions"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filesystemJobs.map((job: IngestJob) => {
                  const progress = percent(job.progress, job.bytes_completed, job.bytes_total);
                  const name = job.display_name || job.source_path;
                  const failure = jobErrorText(job);
                  return [
                    <tr key={job.id} className={`state-${job.state}`}>
                      <td className="col-name" title={job.current_file ? `${job.source_path}\nCurrent: ${job.current_file}` : job.source_path}>{name}</td>
                      <td className="col-size">{formatBytes(job.bytes_completed)} / {formatBytes(job.bytes_total)}</td>
                      <td className="col-progress">
                        <Progress value={progress} />
                        <span>{formatPercent(progress)}</span>
                      </td>
                      <td className={`col-status${failure ? ' has-error' : ''}`}>{stateLabel(job.state)}</td>
                      <td className="col-rate">{formatRate(job.rate_bytes_per_second)}</td>
                      <td className="col-eta">{formatEta(job.eta_seconds)}</td>
                      <td className="col-peers col-optional">{job.files_completed} / {job.files_total}</td>
                      <td className="col-actions">
                        <JobControls
                          variant="row"
                          kind="ingest"
                          id={job.id}
                          name={name}
                          state={job.state}
                          busyAction={busyByJob[jobKey('ingest', job.id)]}
                          confirming={confirmRemove === jobKey('ingest', job.id)}
                          onAction={(action) => { void act('ingest', job.id, job.state, action); }}
                          onConfirm={setConfirmRemove}
                        />
                      </td>
                    </tr>,
                    failure && (
                      <tr key={`${job.id}-error`} className="ingest-error-row">
                        <td colSpan={8}>{failure}</td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}
    </section>
  );
}
