import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import type {
  AcquisitionApi,
  AcquisitionSnapshot,
  IngestJob,
  TorrentJob,
} from '../api/AcquisitionApi';

interface Props {
  api: AcquisitionApi;
}

type JobKind = 'ingest' | 'torrent';
type JobAction = 'pause' | 'resume' | 'delete';

const ingestPauseableStates = new Set(['queued', 'scanning', 'importing']);
const ingestResumableStates = new Set(['paused', 'blocked', 'failed']);
const torrentPauseableStates = new Set(['queued', 'metadata', 'downloading', 'verifying', 'downloaded', 'importing']);
const torrentResumableStates = new Set(['paused', 'blocked']);

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

function canDelete(state: string): boolean {
  return state !== 'completed' && state !== 'cancelled';
}

function Progress({ value }: { value: number | null }) {
  return (
    <div className="ingest-progress-track" aria-hidden="true">
      <span className={value === null ? 'indeterminate' : undefined} style={value === null ? undefined : { width: `${value}%` }} />
    </div>
  );
}

function JobControls({ kind, id, state, busyAction, confirmDelete, onAction, onConfirmDelete }: {
  kind: JobKind;
  id: string;
  state: string;
  busyAction: JobAction | undefined;
  confirmDelete: boolean;
  onAction: (kind: JobKind, id: string, action: JobAction) => void;
  onConfirmDelete: (key: string | undefined) => void;
}) {
  const active = busyAction !== undefined;
  const key = jobKey(kind, id);
  return (
    <div className="ingest-job-actions">
      {canPause(kind, state) && (
        <button className="secondary-button" data-tv-focusable="true" disabled={active} onClick={() => onAction(kind, id, 'pause')}>
          {active && busyAction === 'pause' ? 'Pausing…' : 'Pause'}
        </button>
      )}
      {canResume(kind, state) && (
        <button className="secondary-button" data-tv-focusable="true" disabled={active} onClick={() => onAction(kind, id, 'resume')}>
          {active && busyAction === 'resume' ? 'Resuming…' : 'Resume'}
        </button>
      )}
      {canDelete(state) && !confirmDelete && (
        <button className="secondary-button ingest-delete-button" data-tv-focusable="true" disabled={active} onClick={() => onConfirmDelete(key)}>
          Delete
        </button>
      )}
      {canDelete(state) && confirmDelete && (
        <>
          <button className="secondary-button ingest-delete-button confirm" data-tv-focusable="true" disabled={active} onClick={() => onAction(kind, id, 'delete')}>
            {active && busyAction === 'delete' ? 'Deleting…' : 'Confirm delete'}
          </button>
          <button className="secondary-button" data-tv-focusable="true" disabled={active} onClick={() => onConfirmDelete(undefined)}>
            Keep
          </button>
        </>
      )}
    </div>
  );
}

function IngestJobCard({ job, busyAction, confirmDelete, onAction, onConfirmDelete }: {
  job: IngestJob;
  busyAction: JobAction | undefined;
  confirmDelete: boolean;
  onAction: (kind: JobKind, id: string, action: JobAction) => void;
  onConfirmDelete: (key: string | undefined) => void;
}) {
  const progress = percent(job.progress, job.bytes_completed, job.bytes_total);
  return (
    <article className={`ingest-job-card state-${job.state}`}>
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
      <JobControls kind="ingest" id={job.id} state={job.state} busyAction={busyAction} confirmDelete={confirmDelete} onAction={onAction} onConfirmDelete={onConfirmDelete} />
    </article>
  );
}

function TorrentJobCard({ job, busyAction, confirmDelete, onAction, onConfirmDelete }: {
  job: TorrentJob;
  busyAction: JobAction | undefined;
  confirmDelete: boolean;
  onAction: (kind: JobKind, id: string, action: JobAction) => void;
  onConfirmDelete: (key: string | undefined) => void;
}) {
  const progress = percent(job.progress, job.bytes_completed, job.bytes_total);
  return (
    <article className={`ingest-job-card state-${job.state}`}>
      <div className="ingest-job-heading">
        <div>
          <span className="ingest-state">{stateLabel(job.state)}</span>
          <h3>{job.name || 'Torrent'}</h3>
          {job.info_hash && <p className="ingest-source">{job.info_hash}</p>}
        </div>
        <strong className="ingest-percent">{progress === null ? '—' : `${Math.round(progress)}%`}</strong>
      </div>
      <Progress value={progress} />
      {job.ingest_job_id ? (
        <>
          <dl className="ingest-job-stats ingest-job-stats-import">
            <div><dt>Copied</dt><dd>{formatBytes(job.bytes_completed)} / {formatBytes(job.bytes_total)}</dd></div>
            <div><dt>Rate</dt><dd>{formatRate(job.download_rate)}</dd></div>
            <div><dt>ETA</dt><dd>{formatEta(job.eta_seconds)}</dd></div>
          </dl>
          <p className="ingest-current">Downloaded; importing into the Macha namespace.</p>
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
      {job.error && <p className="ingest-job-error">{job.error}</p>}
      <JobControls kind="torrent" id={job.id} state={job.state} busyAction={busyAction} confirmDelete={confirmDelete} onAction={onAction} onConfirmDelete={onConfirmDelete} />
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
  const [confirmDelete, setConfirmDelete] = useState<string>();

  const refresh = useCallback(async () => {
    const value = await api.snapshot();
    setSnapshot(value);
    setError(undefined);
    return value;
  }, [api]);

  useEffect(() => {
    let active = true;
    let running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const value = await api.snapshot();
        if (active) {
          setSnapshot(value);
          setError(undefined);
          setLoading(false);
        }
      } catch (reason: unknown) {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
        }
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [api]);

  const filesystemJobs = useMemo(
    () => snapshot?.ingestJobs.filter((job) => job.source_type !== 'torrent' && job.state !== 'cancelled') ?? [],
    [snapshot?.ingestJobs],
  );
  const torrentJobs = useMemo(
    () => snapshot?.torrentJobs.filter((job) => job.state !== 'cancelled') ?? [],
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
      setError(reason instanceof Error ? reason.message : String(reason));
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
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(undefined);
    }
  };

  const act = useCallback(async (kind: JobKind, id: string, action: JobAction) => {
    const key = jobKey(kind, id);
    setBusyByJob((current) => ({ ...current, [key]: action }));
    setError(undefined);
    setNotice(undefined);
    try {
      if (kind === 'ingest') {
        if (action === 'pause') await api.pauseIngest(id);
        else if (action === 'resume') await api.resumeIngest(id);
        else await api.cancelIngest(id);
      } else {
        if (action === 'pause') await api.pauseTorrent(id);
        else if (action === 'resume') await api.resumeTorrent(id);
        else await api.cancelTorrent(id);
      }
      if (action === 'delete') setConfirmDelete(undefined);
      await refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
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
              busyAction={busyByJob[jobKey('torrent', job.id)]}
              confirmDelete={confirmDelete === jobKey('torrent', job.id)}
              onAction={(kind, id, action) => { void act(kind, id, action); }}
              onConfirmDelete={setConfirmDelete}
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
              confirmDelete={confirmDelete === jobKey('ingest', job.id)}
              onAction={(kind, id, action) => { void act(kind, id, action); }}
              onConfirmDelete={setConfirmDelete}
            />
          ))}
          {snapshot && filesystemJobs.length === 0 && <p className="ingest-empty">No filesystem import jobs.</p>}
        </div>
      </section>
    </section>
  );
}
