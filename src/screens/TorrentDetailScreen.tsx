import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { routes, type AcquisitionApi, type IngestJob, type TorrentJob } from '@machafoundation/core';
import { JobControls, Progress } from './ingest/JobControls';
import { formatAge, formatBytes, formatEta, formatPercent, formatRate, formatRatio, formatTimestamp, percent, stateLabel } from './ingest/format';
import { MetricTile } from '../components/MetricTile';
import { canRetryImport, displayStateOf, jobKey, linkedIngestOf, torrentLifecycleMessage, torrentStages, type TorrentStage } from './ingest/jobs';
import { useAcquisition } from './ingest/useAcquisition';

function Facts({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return <dl className="torrent-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

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

/**
 * Everything the server reports about one torrent, laid out for the question
 * "why is this not finished": how far it has got, who it is talking to, and
 * which of the three stages on its way into the library it is in, each with
 * what that stage is doing now.
 */
function TorrentBody({ job, linkedIngest }: { job: TorrentJob; linkedIngest?: IngestJob }) {
  const now = Date.now();
  const [download, importStage, catalogueStage] = torrentStages(job, linkedIngest);
  const downloaded = download.status === 'done';
  // Once the payload is handed to an import, the server reports that import's
  // bytes, progress and rate in the torrent's own fields. So the download's
  // figures are only read while the download is what is running.
  const downloadProgress = downloaded ? 100 : percent(job.progress, job.bytes_completed, job.bytes_total);
  const remaining = downloaded ? 0 : Math.max(0, job.bytes_total - job.bytes_completed);
  const catalogue = job.catalogue;
  const catalogueDone = catalogue ? catalogue.catalogued + catalogue.no_match + catalogue.failed : 0;
  const importProgress = importStage.status === 'done' ? 100 : linkedIngest ? percent(linkedIngest.progress, linkedIngest.bytes_completed, linkedIngest.bytes_total) : null;
  const catalogueProgress = catalogueStage.status === 'done' || catalogueStage.status === 'issues' ? 100 : catalogue && catalogue.total > 0 ? (catalogueDone / catalogue.total) * 100 : null;

  // The headline is whichever stage is under way, named, so the big number is
  // never a finished stage's or a stage that has not started.
  const current = [
    { stage: download, progress: downloadProgress, doing: 'Downloading', detail: `${formatBytes(job.bytes_completed)} of ${job.bytes_total > 0 ? formatBytes(job.bytes_total) : 'unknown size'}${remaining > 0 ? ` · ${formatBytes(remaining)} to go · ETA ${formatEta(job.eta_seconds)}` : ''}` },
    { stage: importStage, progress: importProgress, doing: 'Copying into the library', detail: linkedIngest ? `${formatBytes(linkedIngest.bytes_completed)} of ${formatBytes(linkedIngest.bytes_total)} · ${linkedIngest.files_completed} of ${linkedIngest.files_total} files · ETA ${formatEta(linkedIngest.eta_seconds)}` : 'Starting' },
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
        <MetricTile label="Download" value={downloaded ? 'Complete' : formatRate(job.download_rate)} detail={`${job.seeds} seeds · ${job.peers} peers`} />
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
            : 'Copies the finished download into the library.'}
          rows={linkedIngest ? [
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

      <section className="torrent-identity" aria-labelledby="torrent-identity-heading">
        <h2 id="torrent-identity-heading">Torrent</h2>
        <Facts rows={[
          ['Info hash', <code>{job.info_hash || 'Not yet known'}</code>],
          ...(job.node_id ? [['Node', <code>{job.node_id}</code>] as const] : []),
          ['Added', formatTimestamp(job.created_unix_ms)],
          ['Job', <code>{job.id}</code>],
          ...(linkedIngest ? [['Import job', <code>{linkedIngest.id}</code>] as const] : []),
        ]} />
      </section>
    </>
  );
}

/** One torrent's own page. The list carries its sort in the address, and so does the way back. */
export function TorrentDetailScreen({ api }: { api: AcquisitionApi }) {
  const { torrentId = '' } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const { snapshot, loading, error, busyByJob, confirmRemove, setConfirmRemove, act } = useAcquisition(api);
  const back = `${routes.ingestTorrents}${search}`;
  const job = snapshot?.torrentJobs.find((candidate) => candidate.id === torrentId);
  const linked = job ? linkedIngestOf(job, snapshot?.ingestJobs) : undefined;

  if (!job) {
    return (
      <section className="ingest-screen torrent-detail-screen">
        <Link className="back-button" to={back} data-tv-focusable="true">← Torrents</Link>
        {error && <p className="ingest-page-error" role="alert">{error}</p>}
        {loading && !snapshot ? <p className="ingest-loading">Loading torrent…</p> : snapshot && <p className="ingest-empty">This torrent is no longer on the server.</p>}
      </section>
    );
  }

  const state = displayStateOf(job, linked);
  const failure = job.error || linked?.error;
  const lifecycle = torrentLifecycleMessage(job, linked);
  const name = job.name || 'Torrent';
  return (
    <section className="ingest-screen torrent-detail-screen">
      <Link className="back-button" to={back} data-tv-focusable="true">← Torrents</Link>
      <header className="torrent-detail-header">
        <div>
          <span className={`ingest-state state-${state}`}>{stateLabel(state)}</span>
          <h1>{name}</h1>
        </div>
        <JobControls
          variant="page"
          kind="torrent"
          id={job.id}
          name={name}
          state={job.state}
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
      </header>
      {error && <p className="ingest-page-error" role="alert">{error}</p>}
      {failure && <p className="ingest-job-error">{failure}</p>}
      {lifecycle && <p className="ingest-current">{lifecycle}</p>}
      <TorrentBody job={job} linkedIngest={linked} />
    </section>
  );
}
