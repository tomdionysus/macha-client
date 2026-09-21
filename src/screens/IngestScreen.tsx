import { useCallback, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { CardCloseButton } from '../components/CardCloseButton';
import type {
  AcquisitionApi,
  AcquisitionSnapshot,
  IngestJob,
  TorrentJob,
} from '@machafoundation/core';
import { usePollingTask } from '../hooks/usePollingTask';
import { errorMessage } from '@machafoundation/core';
import { presentedTime } from '../diagnostics/timestamps';

interface Props {
  api: AcquisitionApi;
}

type JobKind = 'ingest' | 'torrent';
type JobAction = 'pause' | 'resume' | 'retry' | 'remove';

const ingestPauseableStates = new Set(['queued', 'scanning', 'importing']);
const ingestResumableStates = new Set(['paused', 'blocked', 'failed']);
const torrentPauseableStates = new Set(['queued', 'metadata', 'downloading', 'verifying', 'downloaded', 'importing']);
const torrentResumableStates = new Set(['paused', 'blocked']);
const terminalStates = new Set(['completed', 'cancelled', 'failed']);

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  const decimals = index === 0 || amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(decimals)} ${units[index]}`;
}

function formatRate(value: number): string {
  return value > 0 ? `${formatBytes(value)}/s` : '—';
}

function formatEta(value: number | null): string {
  if (value === null || value < 0 || !Number.isFinite(value)) return '—';
  if (value < 60) return `${Math.ceil(value)}s`;
  if (value < 3600) return `${Math.ceil(value / 60)}m`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.ceil((value % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function percent(progress: number | null, completed: number, total: number): number | null {
  if (progress !== null && Number.isFinite(progress)) return Math.max(0, Math.min(100, progress * 100));
  if (total > 0) return Math.max(0, Math.min(100, (completed / total) * 100));
  return null;
}

function formatTimestamp(value: number): string {
  return presentedTime(value);
}

// Elapsed time, floored: an ETA rounds up because it promises no earlier than
// it says, while an age counts what has actually gone by. Sharing formatEta
// here reported a job created 3600.4s ago as "1h 1m old".
function formatAge(value: number, now: number): string {
  if (!value) return '—';
  const seconds = Math.floor((now - value) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 48) return `${Math.floor(hours / 24)}d ago`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m ago` : `${hours}h ago`;
}

function stateLabel(state: string): string {
  return state.replace(/_/g, ' ').replace(/^./, (value) => value.toUpperCase());
}

function jobKey(kind: JobKind, id: string): string {
  return `${kind}:${id}`;
}

function canPause(kind: JobKind, state: string): boolean {
  return kind === 'ingest' ? ingestPauseableStates.has(state) : torrentPauseableStates.has(state);
}

function canResume(kind: JobKind, state: string): boolean {
  return kind === 'ingest' ? ingestResumableStates.has(state) : torrentResumableStates.has(state);
}

function isTerminal(state: string): boolean {
  return terminalStates.has(state);
}

function torrentLifecycleMessage(job: TorrentJob, linkedIngest?: IngestJob): string | undefined {
  if (!job.ingest_job_id) return undefined;
  const state = linkedIngest?.state ?? job.state;
  if (state === 'completed') return 'Imported into Macha.';
  if (state === 'cataloguing') return 'Imported into the Macha namespace; cataloguing media.';
  if (state === 'cancelled') return 'Import cancelled.';
  if (state === 'failed') return undefined;
  return 'Downloaded; importing into the Macha namespace.';
}

function Progress({ value }: { value: number | null }) {
  return (
    <div className="ingest-progress-track" aria-hidden="true">
      <span className={value === null ? 'indeterminate' : undefined} style={value === null ? undefined : { width: `${value}%` }} />
    </div>
  );
}

function JobControls({ kind, id, state, retryable = false, busyAction, confirmRemove, onAction, onConfirmRemove }: {
  kind: JobKind;
  id: string;
  state: string;
  retryable?: boolean;
  busyAction: JobAction | undefined;
  confirmRemove: boolean;
  onAction: (kind: JobKind, id: string, state: string, action: JobAction) => void;
  onConfirmRemove: (key: string | undefined) => void;
}) {
  const active = busyAction !== undefined;
  return (
    <div className="ingest-job-actions">
      {canPause(kind, state) && (
        <button className="secondary-button" data-tv-focusable="true" disabled={active} onClick={() => onAction(kind, id, state, 'pause')}>
          {active && busyAction === 'pause' ? 'Pausing…' : 'Pause'}
        </button>
      )}
      {canResume(kind, state) && (
        <button className="secondary-button" data-tv-focusable="true" disabled={active} onClick={() => onAction(kind, id, state, 'resume')}>
          {active && busyAction === 'resume' ? 'Resuming…' : 'Resume'}
        </button>
      )}
      {kind === 'torrent' && retryable && (
        <button className="secondary-button" data-tv-focusable="true" disabled={active} onClick={() => onAction(kind, id, state, 'retry')}>
          {active && busyAction === 'retry' ? 'Retrying…' : 'Retry import'}
        </button>
      )}
      {confirmRemove && !isTerminal(state) && (
        <>
          <button className="secondary-button ingest-delete-button confirm" data-tv-focusable="true" disabled={active} onClick={() => onAction(kind, id, state, 'remove')}>
            {active && busyAction === 'remove' ? 'Removing…' : 'Confirm remove'}
          </button>
          <button className="secondary-button" data-tv-focusable="true" disabled={active} onClick={() => onConfirmRemove(undefined)}>
            Keep
          </button>
        </>
      )}
    </div>
  );
}

function IngestJobCard({ job, busyAction, confirmRemove, onAction, onConfirmRemove }: {
  job: IngestJob;
  busyAction: JobAction | undefined;
  confirmRemove: boolean;
  onAction: (kind: JobKind, id: string, state: string, action: JobAction) => void;
  onConfirmRemove: (key: string | undefined) => void;
}) {
  const progress = percent(job.progress, job.bytes_completed, job.bytes_total);
  return (
    <article className={`ingest-job-card state-${job.state}`}>
      <CardCloseButton
        className="ingest-job-remove"
        label={`Remove ${job.display_name || job.source_path} import job`}
        disabled={busyAction !== undefined}
        onClick={() => isTerminal(job.state)
          ? onAction('ingest', job.id, job.state, 'remove')
          : onConfirmRemove(jobKey('ingest', job.id))}
      />
      <div className="ingest-job-heading">
        <div>
          <span className="ingest-state">{stateLabel(job.state)}</span>
          <h3>{job.display_name || job.source_path}</h3>
          <p className="ingest-source" title={job.source_path}>{job.source_path}</p>
        </div>
        <strong className="ingest-percent">{progress === null ? '—' : `${Math.round(progress)}%`}</strong>
      </div>
      <Progress value={progress} />
      <dl className="ingest-job-stats">
        <div><dt>Copied</dt><dd>{formatBytes(job.bytes_completed)} / {formatBytes(job.bytes_total)}</dd></div>
        <div><dt>Files</dt><dd>{job.files_completed} / {job.files_total}</dd></div>
        <div><dt>Rate</dt><dd>{formatRate(job.rate_bytes_per_second)}</dd></div>
        <div><dt>ETA</dt><dd>{formatEta(job.eta_seconds)}</dd></div>
      </dl>
      {job.current_file && <p className="ingest-current">Current: <span>{job.current_file}</span></p>}
      {job.error && <p className="ingest-job-error">{job.error}</p>}
      <JobControls kind="ingest" id={job.id} state={job.state} busyAction={busyAction} confirmRemove={confirmRemove} onAction={onAction} onConfirmRemove={onConfirmRemove} />
    </article>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="ingest-detail-group"><h4>{title}</h4><dl>{children}</dl></section>;
}

/**
 * Share ratio against what this node actually received, not against the
 * torrent's advertised size: a job that has fetched a tenth of the payload and
 * uploaded the same amount has served its peers a full ratio of what it holds.
 */
function shareRatio(job: TorrentJob): string {
  return job.bytes_completed > 0 ? (job.uploaded_total / job.bytes_completed).toFixed(2) : '—';
}

/**
 * Everything the server reports about one torrent, laid out for the question
 * "why is this not finished". The card above says what state the job is in;
 * this says what that state is made of -- who it is talking to, what it has
 * moved, where the payload went, and whether cataloguing recognised any of it.
 */
function TorrentDetail({ id, job, linkedIngest }: { id: string; job: TorrentJob; linkedIngest?: IngestJob }) {
  const now = Date.now();
  const catalogue = job.catalogue;
  return (
    <div className="ingest-job-detail" id={id}>
      <DetailGroup title="Transfer">
        <DetailRow label="Received">{formatBytes(job.bytes_completed)} / {formatBytes(job.bytes_total)}</DetailRow>
        <DetailRow label="Down">{formatRate(job.download_rate)}</DetailRow>
        <DetailRow label="Up">{formatRate(job.upload_rate)}</DetailRow>
        <DetailRow label="Uploaded">{formatBytes(job.uploaded_total)}</DetailRow>
        <DetailRow label="Ratio">{shareRatio(job)}</DetailRow>
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

function TorrentJobCard({ job, linkedIngest, busyAction, confirmRemove, expanded, onAction, onConfirmRemove, onToggleDetail }: {
  job: TorrentJob;
  linkedIngest?: IngestJob;
  busyAction: JobAction | undefined;
  confirmRemove: boolean;
  expanded: boolean;
  onAction: (kind: JobKind, id: string, state: string, action: JobAction) => void;
  onConfirmRemove: (key: string | undefined) => void;
  onToggleDetail: (id: string) => void;
}) {
  const progress = percent(job.progress, job.bytes_completed, job.bytes_total);
  const displayState = linkedIngest?.state ?? job.state;
  const displayError = job.error || linkedIngest?.error;
  const detailId = `torrent-detail-${job.id}`;
  return (
    <article className={`ingest-job-card state-${displayState}`}>
      <CardCloseButton
        className="ingest-job-remove"
        label={`Remove ${job.name || 'torrent'} job`}
        disabled={busyAction !== undefined}
        onClick={() => isTerminal(job.state)
          ? onAction('torrent', job.id, job.state, 'remove')
          : onConfirmRemove(jobKey('torrent', job.id))}
      />
      <button
        type="button"
        className="ingest-job-open"
        data-tv-focusable="true"
        aria-expanded={expanded}
        aria-controls={detailId}
        aria-label={`${job.name || 'Torrent'} details`}
        onClick={() => onToggleDetail(job.id)}
      >
        <div className="ingest-job-heading">
          <div>
            <span className="ingest-state">{stateLabel(displayState)}</span>
            <h3>{job.name || 'Torrent'}</h3>
            {job.info_hash && <p className="ingest-source">{job.info_hash}</p>}
          </div>
          <strong className="ingest-percent">{progress === null ? '—' : `${Math.round(progress)}%`}</strong>
          <span className="ingest-disclosure" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
        </div>
      </button>
      <Progress value={progress} />
      {job.ingest_job_id ? (
        <>
          <dl className="ingest-job-stats ingest-job-stats-import">
            <div><dt>Copied</dt><dd>{formatBytes(job.bytes_completed)} / {formatBytes(job.bytes_total)}</dd></div>
            <div><dt>Rate</dt><dd>{formatRate(job.download_rate)}</dd></div>
            <div><dt>ETA</dt><dd>{formatEta(job.eta_seconds)}</dd></div>
          </dl>
          {torrentLifecycleMessage(job, linkedIngest) && <p className="ingest-current">{torrentLifecycleMessage(job, linkedIngest)}</p>}
        </>
      ) : (
        <dl className="ingest-job-stats">
          <div><dt>Received</dt><dd>{formatBytes(job.bytes_completed)} / {formatBytes(job.bytes_total)}</dd></div>
          <div><dt>Down</dt><dd>{formatRate(job.download_rate)}</dd></div>
          <div><dt>Up</dt><dd>{formatRate(job.upload_rate)}</dd></div>
          <div><dt>ETA</dt><dd>{formatEta(job.eta_seconds)}</dd></div>
          <div><dt>Peers</dt><dd>{job.peers}</dd></div>
          <div><dt>Seeds</dt><dd>{job.seeds}</dd></div>
        </dl>
      )}
      {displayError && <p className="ingest-job-error">{displayError}</p>}
      {expanded && <TorrentDetail id={detailId} job={job} linkedIngest={linkedIngest} />}
      <JobControls
        kind="torrent"
        id={job.id}
        state={job.state}
        retryable={job.state === 'failed' && Boolean(job.ingest_job_id) && linkedIngest?.state === 'failed'}
        busyAction={busyAction}
        confirmRemove={confirmRemove}
        onAction={onAction}
        onConfirmRemove={onConfirmRemove}
      />
    </article>
  );
}

export function IngestScreen({ api }: Props) {
  const [snapshot, setSnapshot] = useState<AcquisitionSnapshot>();
  const [path, setPath] = useState('');
  const [magnet, setMagnet] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyByJob, setBusyByJob] = useState<Record<string, JobAction>>({});
  const [submitting, setSubmitting] = useState<'path' | 'magnet'>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirmRemove, setConfirmRemove] = useState<string>();
  const [openTorrent, setOpenTorrent] = useState<string>();

  const refresh = useCallback(async () => {
    const value = await api.snapshot();
    setSnapshot(value);
    setError(undefined);
    return value;
  }, [api]);

  usePollingTask({
    load: () => api.snapshot(),
    onValue: (value) => {
      setSnapshot(value);
      setError(undefined);
      setLoading(false);
    },
    onError: (reason) => {
      setError(errorMessage(reason));
      setLoading(false);
    },
    intervalMs: 1500,
    dependencies: [api],
  });

  const filesystemJobs = useMemo(
    () => snapshot?.ingestJobs.filter((job) => job.source_type !== 'torrent') ?? [],
    [snapshot?.ingestJobs],
  );
  const torrentJobs = useMemo(
    () => snapshot?.torrentJobs ?? [],
    [snapshot?.torrentJobs],
  );

  const submitPath = async (event: FormEvent) => {
    event.preventDefault();
    const value = path.trim();
    if (!value) return;
    setSubmitting('path');
    setError(undefined);
    setNotice(undefined);
    try {
      await api.submitPath(value);
      setPath('');
      setNotice(`Import queued: ${value}`);
      await refresh();
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(undefined);
    }
  };

  const submitMagnet = async (event: FormEvent) => {
    event.preventDefault();
    const value = magnet.trim();
    if (!value) return;
    if (!/^magnet:\?/i.test(value)) {
      setError('Enter a magnet link beginning with magnet:?.');
      return;
    }
    setSubmitting('magnet');
    setError(undefined);
    setNotice(undefined);
    try {
      await api.submitMagnet(value);
      setMagnet('');
      setNotice('Torrent queued.');
      await refresh();
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(undefined);
    }
  };

  const act = useCallback(async (kind: JobKind, id: string, state: string, action: JobAction) => {
    const key = jobKey(kind, id);
    setBusyByJob((current) => ({ ...current, [key]: action }));
    setError(undefined);
    setNotice(undefined);
    try {
      if (kind === 'ingest') {
        if (action === 'pause') await api.pauseIngest(id);
        else if (action === 'resume') await api.resumeIngest(id);
        else {
          if (!isTerminal(state)) await api.cancelIngest(id);
          await api.clearIngest(id);
        }
      } else {
        if (action === 'pause') await api.pauseTorrent(id);
        else if (action === 'resume') await api.resumeTorrent(id);
        else if (action === 'retry') await api.retryTorrent(id);
        else {
          if (!isTerminal(state)) await api.cancelTorrent(id);
          await api.clearTorrent(id);
        }
      }
      if (action === 'remove') setConfirmRemove(undefined);
      await refresh();
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setBusyByJob((current) => {
        if (current[key] !== action) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }, [api, refresh]);

  const ingestEnabled = snapshot?.ingestStatus.enabled ?? false;
  const torrentEnabled = snapshot?.torrentStatus.enabled ?? false;
  const torrentBuilt = snapshot?.torrentStatus.build_available ?? false;
  const staging = snapshot?.ingestStatus.staging;

  return (
    <section className="ingest-screen">
      <div className="ingest-header">
        <div>
          <p className="eyebrow">Acquisition</p>
          <h1>Import</h1>
          <p>Bring media into Macha from a server-side filesystem path or a BitTorrent magnet link.</p>
        </div>
        {staging && (
          <div className="ingest-staging-summary">
            <span>Staging</span>
            <strong>{formatBytes(staging.accounted_bytes)} / {formatBytes(staging.limit_bytes)}</strong>
            <small title={staging.path}>{staging.path}</small>
          </div>
        )}
      </div>

      <div className="ingest-submit-grid">
        <form className="ingest-submit-card" onSubmit={(event: FormEvent<HTMLFormElement>) => { void submitMagnet(event); }}>
          <span className="ingest-submit-label">Torrent</span>
          <h2>Magnet link</h2>
          <p>The server downloads into its configured staging area and submits the completed payload for import.</p>
          <div className="ingest-submit-line">
            <input data-tv-focusable="true" value={magnet} onChange={(event: ChangeEvent<HTMLInputElement>) => setMagnet(event.target.value)} placeholder="magnet:?xt=urn:btih:…" disabled={!torrentEnabled || submitting === 'magnet'} />
            <button className="primary-button" data-tv-focusable="true" type="submit" disabled={!torrentEnabled || !magnet.trim() || Boolean(submitting)}>
              {submitting === 'magnet' ? 'Adding…' : 'Add torrent'}
            </button>
          </div>
          {!torrentBuilt && snapshot && <p className="ingest-disabled-note">This server was built without libtorrent-rasterbar.</p>}
          {torrentBuilt && !torrentEnabled && snapshot && <p className="ingest-disabled-note">Torrent acquisition is disabled in server configuration.</p>}
        </form>

        <form className="ingest-submit-card" onSubmit={(event: FormEvent<HTMLFormElement>) => { void submitPath(event); }}>
          <span className="ingest-submit-label">Filesystem</span>
          <h2>File or folder path</h2>
          <p>The path is on the Macha server, for example a mounted USB disk. Sources are preserved after a normal manual import.</p>
          <div className="ingest-submit-line">
            <input data-tv-focusable="true" value={path} onChange={(event: ChangeEvent<HTMLInputElement>) => setPath(event.target.value)} placeholder="/media/usb/Movies" disabled={!ingestEnabled || submitting === 'path'} />
            <button className="primary-button" data-tv-focusable="true" type="submit" disabled={!ingestEnabled || !path.trim() || Boolean(submitting)}>
              {submitting === 'path' ? 'Adding…' : 'Start import'}
            </button>
          </div>
          {!ingestEnabled && snapshot && <p className="ingest-disabled-note">Filesystem import is disabled in server configuration.</p>}
        </form>
      </div>

      {error && <p className="ingest-page-error" role="alert">{error}</p>}
      {notice && <p className="ingest-page-notice">{notice}</p>}
      {loading && !snapshot && <p className="ingest-loading">Loading import state…</p>}

      <section className="ingest-job-section">
        <div className="ingest-section-heading">
          <h2>Torrents</h2>
          <span>{torrentJobs.length}</span>
        </div>
        <div className="ingest-job-list">
          {torrentJobs.map((job) => (
            <TorrentJobCard
              key={job.id}
              job={job}
              linkedIngest={job.ingest_job_id ? snapshot?.ingestJobs.find((candidate) => candidate.id === job.ingest_job_id) : undefined}
              busyAction={busyByJob[jobKey('torrent', job.id)]}
              confirmRemove={confirmRemove === jobKey('torrent', job.id)}
              expanded={openTorrent === job.id}
              onAction={(kind, id, state, action) => { void act(kind, id, state, action); }}
              onConfirmRemove={setConfirmRemove}
              onToggleDetail={(id) => setOpenTorrent((current) => (current === id ? undefined : id))}
            />
          ))}
          {snapshot && torrentJobs.length === 0 && <p className="ingest-empty">No torrent jobs.</p>}
        </div>
      </section>

      <section className="ingest-job-section">
        <div className="ingest-section-heading">
          <h2>File and folder imports</h2>
          <span>{filesystemJobs.length}</span>
        </div>
        <div className="ingest-job-list">
          {filesystemJobs.map((job) => (
            <IngestJobCard
              key={job.id}
              job={job}
              busyAction={busyByJob[jobKey('ingest', job.id)]}
              confirmRemove={confirmRemove === jobKey('ingest', job.id)}
              onAction={(kind, id, state, action) => { void act(kind, id, state, action); }}
              onConfirmRemove={setConfirmRemove}
            />
          ))}
          {snapshot && filesystemJobs.length === 0 && <p className="ingest-empty">No filesystem import jobs.</p>}
        </div>
      </section>
    </section>
  );
}
