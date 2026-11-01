import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ingestNodes, routes, type AcquisitionApi, type ClusterStatusApi, type IngestCatalogueItem, type IngestJob, type IngestJobDetail, type IngestJobFile } from '@machafoundation/core';
import { JobControls, Progress } from './ingest/JobControls';
import { jobNodeName } from './ingest/clusterTorrents';
import { useAsync } from '../hooks/useAsync';
import { usePollingTask } from '../hooks/usePollingTask';
import { fileName, formatAge, formatBytes, formatEta, formatPercent, formatRate, formatTimestamp, percent, stateLabel } from './ingest/format';
import { codeWords, jobErrorText } from '../text/viewerText';
import { MetricTile } from '../components/MetricTile';
import { BulkActions, DetailCard, DetailHeader, Facts, Pager, SelectPageBox, SelectRowBox, useListSelection } from '../components/ListParts';
import { pageSlice } from '../lists/paging';
import { ingestStages, jobKey } from './ingest/jobs';
import { useAcquisition } from './ingest/useAcquisition';
import { StageCard } from './TorrentDetailScreen';
import { ConfirmModal } from '../components/Modal';
import { ingestRefusalText } from './ingest/fileImports';

const FILE_STATES: Record<string, string> = {
  queued: 'Waiting',
  paused: 'Paused',
  completed: 'Copied',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
};

/** Where one file stands: by its state from server 0.91.2, else copied, skipped, or how far its copy has got. */
export function fileCopyText(file: IngestJobFile): string {
  if (file.state && file.state !== 'importing') return FILE_STATES[file.state] ?? codeWords(file.state);
  if (file.skipped) return 'Skipped';
  if (file.completed) return 'Copied';
  return `${formatBytes(file.copied)} of ${formatBytes(file.size)}`;
}

export type FileAction = 'pause' | 'resume' | 'cancel';

/** What one file can be asked to do now; nothing from an owner before 0.91.2, which names no index. */
export function fileActions(file: IngestJobFile): FileAction[] {
  if (file.index === undefined) return [];
  if (file.state === 'queued' || file.state === 'importing') return ['pause', 'cancel'];
  if (file.state === 'paused') return ['resume', 'cancel'];
  return [];
}

const FILE_ACTION_LABELS: Record<FileAction, string> = { pause: 'Pause', resume: 'Resume', cancel: 'Cancel' };
const FILE_ACTION_DONE: Record<FileAction, string> = { pause: 'paused', resume: 'resumed', cancel: 'cancelled' };

const CATALOGUE_STATES: Record<string, string> = {
  queued: 'Waiting',
  processing: 'Matching',
  deferred: 'Waiting to retry',
  catalogued: 'Catalogued',
  no_match: 'No match',
  failed: 'Failed',
};

/** A file's catalogue progress, in words; a sidecar is not catalogued. */
export function fileCatalogueText(file: IngestJobFile, item: IngestCatalogueItem | undefined): string {
  if (!file.catalogue_candidate) return 'Not catalogued (a sidecar)';
  if (!item) return '-';
  return CATALOGUE_STATES[item.state] ?? codeWords(item.state);
}

/** How many files are asked at once in a bulk action: the server takes one file per request. */
const FILE_ACTION_CONCURRENCY = 4;

/** Runs `operation` on every item, at most `limit` at a time; resolves to how many failed. */
export async function runInBatches<T>(items: readonly T[], limit: number, operation: (item: T) => Promise<unknown>): Promise<number> {
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try { await operation(item); } catch { failed += 1; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return failed;
}

const fileId = (file: IngestJobFile) => String(file.index);

/** A page at a time: an import can hold thousands of files. Files are ticked across pages, as jobs are. */
function FilesCard({ detail, busy, onAction }: {
  detail: IngestJobDetail;
  /** The indexes of the files an action is under way on. */
  busy: ReadonlySet<number>;
  onAction: (files: readonly IngestJobFile[], action: FileAction) => Promise<boolean>;
}) {
  const [page, setPage] = useState(0);
  const [confirmCancel, setConfirmCancel] = useState<readonly IngestJobFile[]>();
  const controlled = detail.files.some((file) => file.index !== undefined);
  const actionable = useMemo(() => detail.files.filter((file) => fileActions(file).length > 0), [detail.files]);
  const selectable = useMemo(() => actionable.map((file) => ({ id: fileId(file) })), [actionable]);
  const selection = useListSelection(selectable);
  const ticked = actionable.filter((file) => selection.checked.has(fileId(file)));
  const able = (action: FileAction) => ticked.filter((file) => fileActions(file).includes(action));
  const working = busy.size > 0;
  const shown = pageSlice(detail.files, page);
  // Paths compared ignoring case, as the server compares destinations.
  const items = new Map((detail.catalogue?.items ?? []).map((item) => [item.path.toLowerCase(), item]));
  const act = (files: readonly IngestJobFile[], action: FileAction) => {
    void onAction(files, action).then((done) => { if (done && files.length > 1) selection.clear(); });
  };
  return (
    <DetailCard id="ingest-files-heading" title={`Files (${detail.files.length})`}>
      {controlled && (
        <BulkActions label="Selected file actions" selection={selection} disabled={working}>
          <button className="secondary-button" type="button" disabled={working || able('pause').length === 0} onClick={() => act(able('pause'), 'pause')} data-tv-focusable="true">Pause</button>
          <button className="secondary-button" type="button" disabled={working || able('resume').length === 0} onClick={() => act(able('resume'), 'resume')} data-tv-focusable="true">Resume</button>
          <button className="secondary-button ingest-delete-button" type="button" disabled={working || able('cancel').length === 0} onClick={() => setConfirmCancel(able('cancel'))} data-tv-focusable="true">Cancel</button>
        </BulkActions>
      )}
      <div className="data-table-scroll">
        <table className="data-table" aria-labelledby="ingest-files-heading">
          <thead>
            <tr>
              {controlled && (
                <th scope="col" className="col-check">
                  <SelectPageBox ids={shown.items.filter((file) => fileActions(file).length > 0).map(fileId)} selection={selection} disabled={working} />
                </th>
              )}
              <th scope="col" className="col-name">File</th>
              <th scope="col" className="col-size">Size</th>
              <th scope="col" className="col-status">Copy</th>
              <th scope="col" className="col-status">Catalogue</th>
              {controlled && <th scope="col" className="col-file-actions"><span className="visually-hidden">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {shown.items.map((file) => {
              const item = items.get(file.destination_path.toLowerCase());
              const titleId = item?.catalogue_item_ids[0];
              const name = fileName(file.source_path);
              const actions = fileActions(file);
              return (
                <tr key={file.source_path} className={selection.checked.has(fileId(file)) ? 'selected' : undefined}>
                  {controlled && (
                    <td className="col-check">
                      {actions.length > 0 && <SelectRowBox id={fileId(file)} name={name} selection={selection} disabled={working} />}
                    </td>
                  )}
                  <td className="col-name" title={`${file.source_path}\nInto: ${file.destination_path}`}>
                    {titleId ? <Link to={routes.item(titleId)} data-tv-focusable="true">{name}</Link> : name}
                  </td>
                  <td className="col-size">{formatBytes(file.size)}</td>
                  <td className="col-status">{fileCopyText(file)}</td>
                  <td className={`col-status${item?.state === 'failed' ? ' has-error' : ''}`} title={item?.error ?? undefined}>{fileCatalogueText(file, item)}</td>
                  {controlled && (
                    <td className="col-file-actions">
                      <div className="ingest-job-actions ingest-job-actions-row">
                        {actions.map((action) => (
                          <button
                            key={action}
                            type="button"
                            className={`secondary-button${action === 'cancel' ? ' ingest-delete-button' : ''}`}
                            data-tv-focusable="true"
                            disabled={working}
                            aria-label={`${FILE_ACTION_LABELS[action]} ${name}`}
                            onClick={() => (action === 'cancel' ? setConfirmCancel([file]) : act([file], action))}
                          >
                            {file.index !== undefined && busy.has(file.index) ? '…' : FILE_ACTION_LABELS[action]}
                          </button>
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager label="File pages" {...shown} total={detail.files.length} onPage={setPage} />
      {detail.catalogue?.items === null && <p className="list-note">Its node could not be asked, so how each file catalogued is not shown.</p>}
      <ConfirmModal
        open={confirmCancel !== undefined}
        title={confirmCancel?.length === 1 ? 'Cancel this file?' : `Cancel ${confirmCancel?.length ?? 0} files?`}
        confirmLabel={confirmCancel?.length === 1 ? 'Cancel file' : 'Cancel files'}
        destructive
        busy={working}
        onCancel={() => setConfirmCancel(undefined)}
        onConfirm={() => {
          if (confirmCancel) act(confirmCancel, 'cancel');
          setConfirmCancel(undefined);
        }}
      >
        <p>
          {confirmCancel?.length === 1 ? `${fileName(confirmCancel[0].source_path)} is not imported, and what has been copied of it is removed.` : 'They are not imported, and what has been copied of them is removed.'}
          {' '}{confirmCancel?.length === 1 ? 'Its source is left as it is.' : 'Their sources are left as they are.'}
        </p>
      </ConfirmModal>
    </DetailCard>
  );
}

function IngestBody({ job, detail, nodeName, fileBusy, onFileAction }: {
  job: IngestJob;
  detail?: IngestJobDetail;
  nodeName?: string;
  fileBusy: ReadonlySet<number>;
  onFileAction: (files: readonly IngestJobFile[], action: FileAction) => Promise<boolean>;
}) {
  const now = Date.now();
  const [copyStage, catalogueStage] = ingestStages(job);
  const copyProgress = copyStage.status === 'done' ? 100 : percent(job.progress, job.bytes_completed, job.bytes_total);
  const catalogue = job.catalogue;
  const catalogueDone = catalogue ? catalogue.catalogued + catalogue.no_match + catalogue.failed : 0;
  const catalogueProgress = catalogueStage.status === 'done' || catalogueStage.status === 'issues' ? 100 : catalogue && catalogue.total > 0 ? (catalogueDone / catalogue.total) * 100 : null;
  const copying = copyStage.status !== 'done';
  const current = copying
    ? { doing: 'Copying into the library', progress: copyProgress, detail: `${formatBytes(job.bytes_completed)} of ${formatBytes(job.bytes_total)} · ${job.files_completed} of ${job.files_total} files · ETA ${formatEta(job.eta_seconds)}` }
    : catalogueStage.status === 'done' || catalogueStage.status === 'issues'
      ? undefined
      : { doing: 'Cataloguing', progress: catalogueProgress, detail: catalogue ? `${catalogueDone} of ${catalogue.total} files matched or settled` : '' };

  return (
    <>
      <section className="torrent-hero" aria-label="Progress">
        <span className="torrent-hero-stage">{current ? current.doing : catalogueStage.status === 'issues' ? 'Finished, with cataloguing issues' : 'Finished'}</span>
        <div className="torrent-hero-figures">
          <strong>{formatPercent(current ? current.progress : 100)}</strong>
          <span>{current ? current.detail : `${formatBytes(job.bytes_total)} in the library`}</span>
        </div>
        <Progress value={current ? current.progress : 100} />
      </section>

      <div className="metric-grid torrent-metrics">
        <MetricTile label="Rate" value={copying ? formatRate(job.rate_bytes_per_second) : 'Complete'} detail={copying ? `ETA ${formatEta(job.eta_seconds)}` : `${formatBytes(job.bytes_total)} copied`} />
        <MetricTile label="Files" value={`${job.files_completed} / ${job.files_total}`} detail="Copied of those found" />
        <MetricTile label="Node" value={nodeName ?? '-'} detail="Reads the source on its own disk" />
        <MetricTile label="Added" value={formatAge(job.created_unix_ms, now)} detail={`Last change ${formatAge(job.updated_unix_ms, now)}`} />
      </div>

      <div className="torrent-stages ingest-stages">
        <StageCard
          stage={copyStage}
          number={1}
          title="Import"
          progress={copyProgress}
          summary={`${formatBytes(job.bytes_completed)} of ${formatBytes(job.bytes_total)} copied, ${job.files_completed} of ${job.files_total} files.`}
          rows={[
            ...(copying ? [['Rate', formatRate(job.rate_bytes_per_second)] as const, ['ETA', formatEta(job.eta_seconds)] as const] : []),
            ...(job.current_file ? [['Now copying', job.current_file] as const] : []),
            ...(job.current_destination ? [['Into', job.current_destination] as const] : []),
          ]}
        />
        <StageCard
          stage={catalogueStage}
          number={2}
          title="Catalogue"
          progress={catalogueProgress}
          summary={catalogue && catalogue.total > 0 ? `${catalogue.catalogued} of ${catalogue.total} recognised.` : 'Matches each file to a title.'}
          rows={catalogue && catalogue.total > 0 ? [
            ['Catalogued', `${catalogue.catalogued} / ${catalogue.total}`],
            ['Pending', String(catalogue.pending)],
            ['No match', String(catalogue.no_match)],
            ['Failed', String(catalogue.failed)],
          ] : []}
        />
      </div>

      {detail && detail.files.length > 0 && <FilesCard detail={detail} busy={fileBusy} onAction={onFileAction} />}

      <DetailCard id="ingest-identity-heading" title="Import">
        <Facts rows={[
          ['Source', <code>{job.source_path}</code>],
          ['Node', nodeName ?? 'Not named by this server'],
          ['Source after clearing', job.delete_source_on_clear ? 'Deleted' : 'Kept'],
          ['Added', formatTimestamp(job.created_unix_ms)],
          ['Job', <code>{job.id}</code>],
        ]} />
      </DetailCard>
    </>
  );
}

/** One file import's page: its progress, its files and how each catalogued. */
export function IngestJobDetailScreen({ api, statusApi }: { api: AcquisitionApi; statusApi?: ClusterStatusApi }) {
  const { jobId = '' } = useParams();
  const navigate = useNavigate();
  const { snapshot, loading, error, setError, refresh, busyByJob, confirmRemove, setConfirmRemove, act } = useAcquisition(api);
  const [fileBusy, setFileBusy] = useState<ReadonlySet<number>>(() => new Set());
  const nodes = useAsync(() => statusApi ? statusApi.status().then(ingestNodes) : Promise.resolve(undefined), [statusApi]);
  const [detail, setDetail] = useState<IngestJobDetail>();
  const back = routes.ingestFiles;
  const listed = snapshot?.ingestJobs.find((candidate) => candidate.id === jobId);

  // The owner's own answer, for the files; polled at the list's pace while the job is listed.
  usePollingTask({
    load: () => api.ingestJob(jobId),
    onValue: setDetail,
    onError: () => setDetail(undefined),
    intervalMs: snapshot?.refreshIntervalMs ?? 5_000,
    dependencies: [api, jobId, snapshot?.refreshIntervalMs],
    enabled: Boolean(listed),
  });

  /**
   * Files' action, a few at a time, then the job and its files read again so the rows show what the
   * node did. One file's refusal is the node's words; several are counted. Resolves to whether all took.
   */
  const actOnFiles = async (files: readonly IngestJobFile[], action: FileAction): Promise<boolean> => {
    const indexes = files.flatMap((file) => (file.index === undefined ? [] : [file.index]));
    if (indexes.length === 0) return true;
    setFileBusy(new Set(indexes));
    setError(undefined);
    const call = action === 'pause' ? api.pauseIngestFile : action === 'resume' ? api.resumeIngestFile : api.cancelIngestFile;
    let refusal: unknown;
    const failed = await runInBatches(indexes, FILE_ACTION_CONCURRENCY, (index) => call.call(api, jobId, index).catch((reason: unknown) => {
      refusal = reason;
      throw reason;
    }));
    try {
      setDetail(await api.ingestJob(jobId));
      await refresh();
    } catch (reason: unknown) {
      refusal ??= reason;
    }
    if (failed > 0) {
      setError(indexes.length === 1 ? ingestRefusalText(refusal) : `${failed} of ${indexes.length} files could not be ${FILE_ACTION_DONE[action]}.`);
    }
    setFileBusy(new Set());
    return failed === 0;
  };

  if (!listed) {
    return (
      <section className="ingest-screen detail-screen">
        <Link className="back-button" to={back} data-tv-focusable="true">← File imports</Link>
        {error && <p className="ingest-page-error" role="alert">{error}</p>}
        {loading && !snapshot ? <p className="ingest-loading">Loading import…</p> : snapshot && <p className="list-empty">This import is no longer on the server.</p>}
      </section>
    );
  }

  const job = listed;
  const failure = jobErrorText(job);
  const name = job.display_name || job.source_path;
  const names = new Map<string, string>(nodes.value?.map((node) => [node.nodeId, node.name]) ?? []);
  return (
    <section className="ingest-screen detail-screen">
      <Link className="back-button" to={back} data-tv-focusable="true">← File imports</Link>
      <DetailHeader
        kicker={stateLabel(job.state)}
        kickerClass={`state-${job.state}`}
        title={name}
        actions={(
          <JobControls
            variant="page"
            kind="ingest"
            id={job.id}
            name={name}
            state={job.state}
            busyAction={busyByJob[jobKey('ingest', job.id)]}
            confirming={confirmRemove === jobKey('ingest', job.id)}
            onAction={(action) => {
              void act('ingest', job.id, job.state, action).then((done) => {
                if (done && action === 'remove') navigate(back);
              });
            }}
            onConfirm={setConfirmRemove}
          />
        )}
      />
      {error && <p className="ingest-page-error" role="alert">{error}</p>}
      {failure && <p className="ingest-job-error">{failure}</p>}
      <IngestBody job={job} detail={detail?.id === job.id ? detail : undefined} nodeName={jobNodeName(job.node_id, names)} fileBusy={fileBusy} onFileAction={actOnFiles} />
    </section>
  );
}
