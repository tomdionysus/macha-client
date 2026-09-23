import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { routes, type AcquisitionApi, type IngestJob, type TorrentJob } from '@machafoundation/core';
import { JobControls, Progress } from './ingest/JobControls';
import { formatAge, formatBytes, formatEta, formatPercent, formatRate, formatRatio, formatTimestamp, percent, stateLabel } from './ingest/format';
import { canRetryImport, displayStateOf, jobKey, linkedIngestOf, torrentLifecycleMessage } from './ingest/jobs';
import { useAcquisition } from './ingest/useAcquisition';

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="ingest-detail-group"><h2>{title}</h2><dl>{children}</dl></section>;
}

/**
 * Everything the server reports about one torrent, laid out for the question
 * "why is this not finished": who it is talking to, what it has moved, where
 * the payload went, and whether cataloguing recognised any of it.
 */
function TorrentFacts({ job, linkedIngest }: { job: TorrentJob; linkedIngest?: IngestJob }) {
  const now = Date.now();
  const catalogue = job.catalogue;
  return (
    <div className="ingest-job-detail">
      <DetailGroup title="Transfer">
        <DetailRow label="Received">{formatBytes(job.bytes_completed)} / {formatBytes(job.bytes_total)}</DetailRow>
        <DetailRow label="Down">{formatRate(job.download_rate)}</DetailRow>
        <DetailRow label="Up">{formatRate(job.upload_rate)}</DetailRow>
        <DetailRow label="Uploaded">{formatBytes(job.uploaded_total)}</DetailRow>
        <DetailRow label="Ratio">{formatRatio(job)}</DetailRow>
        <DetailRow label="Peers">{job.peers}</DetailRow>
        <DetailRow label="Seeds">{job.seeds}</DetailRow>
        <DetailRow label="ETA">{formatEta(job.eta_seconds)}</DetailRow>
      </DetailGroup>
      <DetailGroup title="Torrent">
        <DetailRow label="Info hash"><code>{job.info_hash || 'Not yet known'}</code></DetailRow>
        {job.node_id && <DetailRow label="Node">{job.node_id}</DetailRow>}
        <DetailRow label="Added">{formatTimestamp(job.created_unix_ms)}</DetailRow>
        <DetailRow label="Age">{formatAge(job.created_unix_ms, now)}</DetailRow>
        <DetailRow label="Last change">{formatAge(job.updated_unix_ms, now)}</DetailRow>
        <DetailRow label="Job">{job.id}</DetailRow>
      </DetailGroup>
      {linkedIngest && (
        <DetailGroup title="Import job">
          <DetailRow label="State">{stateLabel(linkedIngest.state)}</DetailRow>
          <DetailRow label="Copied">{formatBytes(linkedIngest.bytes_completed)} / {formatBytes(linkedIngest.bytes_total)}</DetailRow>
          <DetailRow label="Files">{linkedIngest.files_completed} / {linkedIngest.files_total}</DetailRow>
          <DetailRow label="Rate">{formatRate(linkedIngest.rate_bytes_per_second)}</DetailRow>
          <DetailRow label="Staged at">{linkedIngest.source_path}</DetailRow>
          {linkedIngest.current_file && <DetailRow label="Current file">{linkedIngest.current_file}</DetailRow>}
          {linkedIngest.current_destination && <DetailRow label="Destination">{linkedIngest.current_destination}</DetailRow>}
        </DetailGroup>
      )}
      {catalogue && (catalogue.total > 0 || catalogue.state !== 'waiting') && (
        <DetailGroup title="Catalogue">
          <DetailRow label="State">{stateLabel(catalogue.state)}</DetailRow>
          <DetailRow label="Catalogued">{catalogue.catalogued} / {catalogue.total}</DetailRow>
          <DetailRow label="Pending">{catalogue.pending}</DetailRow>
          <DetailRow label="No match">{catalogue.no_match}</DetailRow>
          <DetailRow label="Failed">{catalogue.failed}</DetailRow>
        </DetailGroup>
      )}
    </div>
  );
}

/** One torrent's own page. The list carries its sort in the address, and so does the way back. */
export function TorrentDetailScreen({ api }: { api: AcquisitionApi }) {
  const { torrentId = '' } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const { snapshot, loading, error, busyByJob, confirmRemove, setConfirmRemove, act } = useAcquisition(api);
  const back = `${routes.ingest}${search}`;
  const job = snapshot?.torrentJobs.find((candidate) => candidate.id === torrentId);
  const linked = job ? linkedIngestOf(job, snapshot?.ingestJobs) : undefined;

  if (!job) {
    return (
      <section className="ingest-screen torrent-detail-screen">
        <Link className="ingest-back" to={back} data-tv-focusable="true">Import</Link>
        {error && <p className="ingest-page-error" role="alert">{error}</p>}
        {loading && !snapshot ? <p className="ingest-loading">Loading torrent…</p> : snapshot && <p className="ingest-empty">This torrent is no longer on the server.</p>}
      </section>
    );
  }

  const state = displayStateOf(job, linked);
  const progress = percent(job.progress, job.bytes_completed, job.bytes_total);
  const failure = job.error || linked?.error;
  const lifecycle = torrentLifecycleMessage(job, linked);
  const name = job.name || 'Torrent';
  return (
    <section className="ingest-screen torrent-detail-screen">
      <Link className="ingest-back" to={back} data-tv-focusable="true">Import</Link>
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
      <div className="torrent-detail-progress">
        <Progress value={progress} />
        <strong>{formatPercent(progress)}</strong>
      </div>
      {error && <p className="ingest-page-error" role="alert">{error}</p>}
      {failure && <p className="ingest-job-error">{failure}</p>}
      {lifecycle && <p className="ingest-current">{lifecycle}</p>}
      <TorrentFacts job={job} linkedIngest={linked} />
    </section>
  );
}
