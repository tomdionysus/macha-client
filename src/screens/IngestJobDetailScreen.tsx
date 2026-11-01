import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ingestNodes, routes, type AcquisitionApi, type ClusterStatusApi, type IngestCatalogueItem, type IngestJob, type IngestJobDetail, type IngestJobFile } from '@machafoundation/core';
import { JobControls, Progress } from './ingest/JobControls';
import { jobNodeName } from './ingest/clusterTorrents';
import { useAsync } from '../hooks/useAsync';
import { usePollingTask } from '../hooks/usePollingTask';
import { fileName, formatAge, formatBytes, formatEta, formatPercent, formatRate, formatTimestamp, percent, stateLabel } from './ingest/format';
import { codeWords, jobErrorText } from '../text/viewerText';
import { MetricTile } from '../components/MetricTile';
import { DetailCard, DetailHeader, Facts, Pager } from '../components/ListParts';
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

/** A page at a time: an import can hold thousands of files. */
function FilesCard({ detail, busy, onAction }: {
  detail: IngestJobDetail;
  /** The index of the file an action is under way on. */
  busy?: number;
  onAction: (file: IngestJobFile, action: FileAction) => void;
}) {
  const [page, setPage] = useState(0);
  const [confirmCancel, setConfirmCancel] = useState<IngestJobFile>();
  const controlled = detail.files.some((file) => file.index !== undefined);
  const shown = pageSlice(detail.files, page);
  // Paths compared ignoring case, as the server compares destinations.
  const items = new Map((detail.catalogue?.items ?? []).map((item) => [item.path.toLowerCase(), item]));
  return (
    <DetailCard id="ingest-files-heading" title={`Files (${detail.files.length})`}>
      <div className="data-table-scroll">
        <table className="data-table" aria-labelledby="ingest-files-heading">
          <thead>
            <tr>
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
              return (
                <tr key={file.source_path}>
                  <td className="col-name" title={`${file.source_path}\nInto: ${file.destination_path}`}>
                    {titleId ? <Link to={routes.item(titleId)} data-tv-focusable="true">{fileName(file.source_path)}</Link> : fileName(file.source_path)}
                  </td>
                  <td className="col-size">{formatBytes(file.size)}</td>
                  <td className="col-status">{fileCopyText(file)}</td>
                  <td className={`col-status${item?.state === 'failed' ? ' has-error' : ''}`} title={item?.error ?? undefined}>{fileCatalogueText(file, item)}</td>
                  {controlled && (
                    <td className="col-file-actions">
                      <div className="ingest-job-actions ingest-job-actions-row">
                        {fileActions(file).map((action) => (
                          <button
                            key={action}
                            type="button"
                            className={`secondary-button${action === 'cancel' ? ' ingest-delete-button' : ''}`}
                            data-tv-focusable="true"
                            disabled={busy !== undefined}
                            aria-label={`${FILE_ACTION_LABELS[action]} ${fileName(file.source_path)}`}
                            onClick={() => (action === 'cancel' ? setConfirmCancel(file) : onAction(file, action))}
                          >
                            {busy === file.index ? '…' : FILE_ACTION_LABELS[action]}
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
        title="Cancel this file?"
        confirmLabel="Cancel file"
        destructive
        busy={busy !== undefined}
        onCancel={() => setConfirmCancel(undefined)}
        onConfirm={() => {
          if (confirmCancel) onAction(confirmCancel, 'cancel');
          setConfirmCancel(undefined);
        }}
      >
        <p>{confirmCancel ? fileName(confirmCancel.source_path) : ''} is not imported, and what has been copied of it is removed. Its source is left as it is.</p>
      </ConfirmModal>
    </DetailCard>
  );
}

function IngestBody({ job, detail, nodeName, fileBusy, onFileAction }: {
  job: IngestJob;
  detail?: IngestJobDetail;
  nodeName?: string;
  fileBusy?: number;
  onFileAction: (file: IngestJobFile, action: FileAction) => void;
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
  const [fileBusy, setFileBusy] = useState<number>();
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

  /** One file's action, then the job and its files read again so the row shows what the node did. */
  const actOnFile = async (file: IngestJobFile, action: FileAction) => {
    if (file.index === undefined) return;
    setFileBusy(file.index);
    setError(undefined);
    try {
      const call = action === 'pause' ? api.pauseIngestFile : action === 'resume' ? api.resumeIngestFile : api.cancelIngestFile;
      await call.call(api, jobId, file.index);
      setDetail(await api.ingestJob(jobId));
      await refresh();
    } catch (reason: unknown) {
      setError(ingestRefusalText(reason));
    } finally {
      setFileBusy(undefined);
    }
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
      <IngestBody job={job} detail={detail?.id === job.id ? detail : undefined} nodeName={jobNodeName(job.node_id, names)} fileBusy={fileBusy} onFileAction={(file, action) => { void actOnFile(file, action); }} />
    </section>
  );
}
