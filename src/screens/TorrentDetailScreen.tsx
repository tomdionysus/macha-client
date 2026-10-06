import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { routes, type AcquisitionApi, type IngestJob, type TorrentJob } from '@machafoundation/core';
import { JobControls, Progress } from './ingest/JobControls';
import { intentNote, jobNodeName } from './ingest/clusterTorrents';
import { placementRefusalText, TorrentPlacement } from './ingest/TorrentPlacement';
import { useAsync } from '../hooks/useAsync';
import { formatAge, formatBytes, formatCount, formatEta, formatPercent, formatRate, formatRatio, formatTimestamp, percent, stateLabel } from './ingest/format';
import { jobErrorText } from '../text/viewerText';
import { MetricTile } from '../components/MetricTile';
import { DetailCard, DetailHeader, Facts } from '../components/ListParts';
import { canRetryImport, displayStateOf, heldStatus, jobKey, linkedIngestOf, storingOf, storingPercent, storingStallText, torrentLifecycleMessage, torrentStages, type TorrentStage } from './ingest/jobs';
import { useAcquisition } from './ingest/useAcquisition';

/** One stage of the way in: where it stands, how far it has got, and what it is doing now. */
function StageCard({ stage, title, number, progress, summary, rows }: {
  stage: TorrentStage;
  title: string;
  number: number;
  progress: number | null;
  summary: string;
  rows: ReadonlyArray<readonly [string, ReactNode]>;
}) {
  return (
    <section className={`torrent-stage stage-${stage.status}`} aria-labelledby={`stage-${stage.key}`}>
      <header>
        <span className="torrent-stage-number" aria-hidden="true">{number}</span>
        <h2 id={`stage-${stage.key}`}>{title}</h2>
        <span className="torrent-stage-status">{stage.label}</span>
      </header>
      <Progress value={stage.status === 'waiting' ? 0 : progress} />
      <p className="torrent-stage-summary">{summary}</p>
      {rows.length > 0 && <Facts rows={rows} />}
    </section>
  );
}

/** Everything the server reports about one torrent: progress, peers, and its three stages into the library. */
function TorrentBody({ job, linkedIngest, nodeHosts }: { job: TorrentJob; linkedIngest?: IngestJob; nodeHosts: ReadonlyMap<string, string> }) {
  const now = Date.now();
  const [download, importStage, catalogueStage] = torrentStages(job, linkedIngest);
  const downloaded = download.status === 'done';
  // Once an import has the payload, the torrent's byte, progress and rate fields describe that import.
  const downloadProgress = downloaded ? 100 : percent(job.progress, job.bytes_completed, job.bytes_total);
  // Unknown while the owning node is out of view: nothing is said to remain.
  const remaining = downloaded || job.bytes_total === null || job.bytes_completed === null ? 0 : Math.max(0, job.bytes_total - job.bytes_completed);
  const catalogue = job.catalogue;
  const catalogueDone = catalogue ? catalogue.catalogued + catalogue.no_match + catalogue.failed : 0;
  // Between download and import the owner stores the payload in the cluster; the import stage shows that.
  const storing = linkedIngest ? undefined : storingOf(job);
  const storingStall = storing && storingStallText(storing);
  const storedText = storing && `${formatBytes(storing.published_bytes)} of ${formatBytes(storing.bytes)} stored${storingStall ? `, ${storingStall}` : ''}`;
  const importProgress = importStage.status === 'done' ? 100
    : linkedIngest ? percent(linkedIngest.progress, linkedIngest.bytes_completed, linkedIngest.bytes_total)
      : storing ? storingPercent(storing) ?? null : null;
  const catalogueProgress = catalogueStage.status === 'done' || catalogueStage.status === 'issues' ? 100 : catalogue && catalogue.total > 0 ? (catalogueDone / catalogue.total) * 100 : null;

  // The headline is whichever stage is under way.
  const current = [
    { stage: download, progress: downloadProgress, ...downloadStageText(job, remaining) },
    { stage: importStage, progress: importProgress, doing: storing ? 'Storing in the cluster' : 'Copying into the library', detail: linkedIngest ? `${formatBytes(linkedIngest.bytes_completed)} of ${formatBytes(linkedIngest.bytes_total)} · ${linkedIngest.files_completed} of ${linkedIngest.files_total} files · ETA ${formatEta(linkedIngest.eta_seconds)}` : storedText ?? 'Starting' },
    { stage: catalogueStage, progress: catalogueProgress, doing: 'Cataloguing', detail: catalogue ? `${catalogueDone} of ${catalogue.total} files matched or settled` : '' },
  ].find((entry) => entry.stage.status !== 'done' && entry.stage.status !== 'issues');

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
        <MetricTile label="Download" value={downloaded ? 'Complete' : formatRate(job.download_rate)} detail={`${formatCount(job.seeds)} seeds · ${formatCount(job.peers)} peers`} />
        <MetricTile label="Upload" value={formatRate(job.upload_rate)} detail={`${formatBytes(job.uploaded_total)} sent`} />
        <MetricTile label="Ratio" value={formatRatio(job)} detail="Sent against what this node holds" />
        <MetricTile label="Added" value={formatAge(job.created_unix_ms, now)} detail={`Last change ${formatAge(job.updated_unix_ms, now)}`} />
      </div>

      <div className="torrent-stages">
        <StageCard
          stage={download}
          number={1}
          title="Download"
          progress={downloadProgress}
          summary={downloaded ? `All ${formatBytes(job.bytes_total)} received.` : `${formatBytes(job.bytes_completed)} of ${formatBytes(job.bytes_total)} received.`}
          rows={downloaded ? [] : [
            ['Remaining', formatBytes(remaining)],
            ['ETA', formatEta(job.eta_seconds)],
          ]}
        />
        <StageCard
          stage={importStage}
          number={2}
          title="Import"
          progress={importProgress}
          summary={linkedIngest
            ? `${formatBytes(linkedIngest.bytes_completed)} of ${formatBytes(linkedIngest.bytes_total)} copied, ${linkedIngest.files_completed} of ${linkedIngest.files_total} files.`
            : storedText ? `${storedText}.` : 'Copies the finished download into the library.'}
          rows={storing ? [
            ['Extents', `${storing.published_extents} / ${storing.extents}`],
          ] : linkedIngest ? [
            ...(importStage.status === 'done' ? [] : [
              ['Rate', formatRate(linkedIngest.rate_bytes_per_second)] as const,
              ['ETA', formatEta(linkedIngest.eta_seconds)] as const,
            ]),
            ['Staged at', linkedIngest.source_path],
            ...(linkedIngest.current_file ? [['Now copying', linkedIngest.current_file] as const] : []),
            ...(linkedIngest.current_destination ? [['Into', linkedIngest.current_destination] as const] : []),
          ] : []}
        />
        <StageCard
          stage={catalogueStage}
          number={3}
          title="Catalogue"
          progress={catalogueProgress}
          summary={catalogue && catalogue.total > 0
            ? `${catalogue.catalogued} of ${catalogue.total} recognised.`
            : 'Matches each file to a title.'}
          rows={catalogue && catalogue.total > 0 ? [
            ['Catalogued', `${catalogue.catalogued} / ${catalogue.total}`],
            ['Pending', String(catalogue.pending)],
            ['No match', String(catalogue.no_match)],
            ['Failed', String(catalogue.failed)],
          ] : []}
        />
      </div>

      <DetailCard id="torrent-identity-heading" title="Torrent">
        <Facts rows={[
          ['Info hash', <code>{job.info_hash || 'Not yet known'}</code>],
          // A torrent is the cluster's until a node claims it.
          ['Node', jobNodeName(job.node_id, nodeHosts) ?? 'Not yet claimed by a node'],
          ...(job.pinned_node_id ? [['Pinned to', jobNodeName(job.pinned_node_id, nodeHosts)!] as const] : []),
          ...(job.ingest_node_id ? [['Importing on', jobNodeName(job.ingest_node_id, nodeHosts)!] as const] : []),
          ...(job.swarm ? [['Swarm', swarmText(job.swarm)] as const] : []),
          ...(job.remove_at_unix_ms ? [['Removed at', formatTimestamp(job.remove_at_unix_ms)] as const] : []),
          ['Added', formatTimestamp(job.created_unix_ms)],
          ['Job', <code>{job.id}</code>],
          ...(linkedIngest ? [['Import job', <code>{linkedIngest.id}</code>] as const] : []),
        ]} />
      </DetailCard>
    </>
  );
}

/**
 * What the download stage is doing. Torrents check their existing data one at
 * a time: `verify_queued` waits for another's check, `verifying` is its own,
 * with `eta_seconds` for the check. `progress` is valid pieces over the total.
 */
/** The trackers' count of the swarm, and how much of the torrent the connected peers hold between them. */
export function swarmText(swarm: NonNullable<TorrentJob['swarm']>): string {
  return [
    `${swarm.availability.toFixed(2)} available`,
    swarm.seeds !== null ? `${swarm.seeds} seeds` : undefined,
    swarm.peers !== null ? `${swarm.peers} peers` : undefined,
  ].filter(Boolean).join(' · ');
}

/** Said under a download whose connected peers lack a piece between them: the reason it crawls or stops. */
export const PIECES_MISSING_TEXT = 'Some of it is held by no connected peer, so it cannot finish until one joins.';

export function downloadStageText(job: Pick<TorrentJob, 'state' | 'bytes_completed' | 'bytes_total' | 'eta_seconds' | 'swarm'>, remaining: number): { doing: string; detail: string } {
  const of = `${formatBytes(job.bytes_completed)} of ${job.bytes_total !== null && job.bytes_total > 0 ? formatBytes(job.bytes_total) : 'unknown size'}`;
  if (job.state === 'verify_queued') return { doing: 'Waiting to verify', detail: 'Waiting for another torrent\'s check to finish' };
  if (job.state === 'verifying') return { doing: 'Verifying data already on disk', detail: `${of} verified · ETA ${formatEta(job.eta_seconds)}` };
  const missing = remaining > 0 && job.swarm && job.swarm.availability < 1 ? ` · ${PIECES_MISSING_TEXT}` : '';
  return { doing: 'Downloading', detail: `${of}${remaining > 0 ? ` · ${formatBytes(remaining)} to go · ETA ${formatEta(job.eta_seconds)}` : ''}${missing}` };
}

/** One torrent's page. The way back carries the list's sort in the address. */
export function TorrentDetailScreen({ api }: { api: AcquisitionApi }) {
  const { torrentId = '' } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const { snapshot, loading, error, setError, refresh, busyByJob, confirmRemove, setConfirmRemove, act } = useAcquisition(api);
  const torrentNodes = useAsync(() => api.torrentNodes(), [api]);
  const back = `${routes.ingestTorrents}${search}`;
  const job = snapshot?.torrentJobs.find((candidate) => candidate.id === torrentId);
  const linked = job ? linkedIngestOf(job, snapshot?.ingestJobs) : undefined;

  if (!job) {
    return (
      <section className="ingest-screen detail-screen">
        <Link className="back-button" to={back} data-tv-focusable="true">← Torrents</Link>
        {error && <p className="ingest-page-error" role="alert">{error}</p>}
        {loading && !snapshot ? <p className="ingest-loading">Loading torrent…</p> : snapshot && <p className="list-empty">This torrent is no longer on the server.</p>}
      </section>
    );
  }

  const state = displayStateOf(job, linked);
  const failure = jobErrorText(job) ?? jobErrorText(linked);
  const lifecycle = torrentLifecycleMessage(job, linked);
  const name = job.name || 'Torrent';
  return (
    <section className="ingest-screen detail-screen">
      <Link className="back-button" to={back} data-tv-focusable="true">← Torrents</Link>
      <DetailHeader
        kicker={intentNote(job, Date.now(), snapshot?.refreshIntervalMs ?? 5_000) ?? heldStatus(job) ?? stateLabel(state)}
        kickerClass={`state-${state}`}
        title={name}
        actions={(
          <JobControls
            variant="page"
            kind="torrent"
            id={job.id}
            name={name}
            state={job.state}
            desired={job.desired}
            retryable={canRetryImport(job, linked)}
            busyAction={busyByJob[jobKey('torrent', job.id)]}
            confirming={confirmRemove === jobKey('torrent', job.id)}
            onAction={(action) => {
              void act('torrent', job.id, job.state, action).then((done) => {
                if (done && action === 'remove') navigate(back);
              });
            }}
            onConfirm={setConfirmRemove}
          />
        )}
      />
      {error && <p className="ingest-page-error" role="alert">{error}</p>}
      {failure && <p className="ingest-job-error">{failure}</p>}
      {lifecycle && <p className="ingest-current">{lifecycle}</p>}
      <TorrentPlacement
        api={api}
        job={job}
        nodes={torrentNodes.value}
        onChanged={() => { setError(undefined); void refresh(); }}
        onError={(reason) => setError(placementRefusalText(reason))}
      />
      <TorrentBody job={job} linkedIngest={linked} nodeHosts={new Map(torrentNodes.value?.nodes.map((node) => [node.node_id, node.host]) ?? [])} />
    </section>
  );
}
