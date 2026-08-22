import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CardCloseButton } from '../components/CardCloseButton';
const ingestPauseableStates = new Set(['queued', 'scanning', 'importing']);
const ingestResumableStates = new Set(['paused', 'blocked', 'failed']);
const torrentPauseableStates = new Set(['queued', 'metadata', 'downloading', 'verifying', 'downloaded', 'importing']);
const torrentResumableStates = new Set(['paused', 'blocked']);
const terminalStates = new Set(['completed', 'cancelled', 'failed']);
function formatBytes(value) {
    if (!Number.isFinite(value) || value <= 0)
        return '0 B';
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
function formatRate(value) {
    return value > 0 ? `${formatBytes(value)}/s` : '—';
}
function formatEta(value) {
    if (value === null || value < 0 || !Number.isFinite(value))
        return '—';
    if (value < 60)
        return `${Math.ceil(value)}s`;
    if (value < 3600)
        return `${Math.ceil(value / 60)}m`;
    const hours = Math.floor(value / 3600);
    const minutes = Math.ceil((value % 3600) / 60);
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}
function percent(progress, completed, total) {
    if (progress !== null && Number.isFinite(progress))
        return Math.max(0, Math.min(100, progress * 100));
    if (total > 0)
        return Math.max(0, Math.min(100, (completed / total) * 100));
    return null;
}
function stateLabel(state) {
    return state.replace(/_/g, ' ').replace(/^./, (value) => value.toUpperCase());
}
function jobKey(kind, id) {
    return `${kind}:${id}`;
}
function canPause(kind, state) {
    return kind === 'ingest' ? ingestPauseableStates.has(state) : torrentPauseableStates.has(state);
}
function canResume(kind, state) {
    return kind === 'ingest' ? ingestResumableStates.has(state) : torrentResumableStates.has(state);
}
function isTerminal(state) {
    return terminalStates.has(state);
}
function torrentLifecycleMessage(job, linkedIngest) {
    if (!job.ingest_job_id)
        return undefined;
    const state = linkedIngest?.state ?? job.state;
    if (state === 'completed')
        return 'Imported into Macha.';
    if (state === 'cataloguing')
        return 'Imported into the Macha namespace; cataloguing media.';
    if (state === 'cancelled')
        return 'Import cancelled.';
    if (state === 'failed')
        return undefined;
    return 'Downloaded; importing into the Macha namespace.';
}
function Progress({ value }) {
    return (_jsx("div", { className: "ingest-progress-track", "aria-hidden": "true", children: _jsx("span", { className: value === null ? 'indeterminate' : undefined, style: value === null ? undefined : { width: `${value}%` } }) }));
}
function JobControls({ kind, id, state, busyAction, confirmRemove, onAction, onConfirmRemove }) {
    const active = busyAction !== undefined;
    return (_jsxs("div", { className: "ingest-job-actions", children: [canPause(kind, state) && (_jsx("button", { className: "secondary-button", "data-tv-focusable": "true", disabled: active, onClick: () => onAction(kind, id, state, 'pause'), children: active && busyAction === 'pause' ? 'Pausing…' : 'Pause' })), canResume(kind, state) && (_jsx("button", { className: "secondary-button", "data-tv-focusable": "true", disabled: active, onClick: () => onAction(kind, id, state, 'resume'), children: active && busyAction === 'resume' ? 'Resuming…' : 'Resume' })), confirmRemove && !isTerminal(state) && (_jsxs(_Fragment, { children: [_jsx("button", { className: "secondary-button ingest-delete-button confirm", "data-tv-focusable": "true", disabled: active, onClick: () => onAction(kind, id, state, 'remove'), children: active && busyAction === 'remove' ? 'Removing…' : 'Confirm remove' }), _jsx("button", { className: "secondary-button", "data-tv-focusable": "true", disabled: active, onClick: () => onConfirmRemove(undefined), children: "Keep" })] }))] }));
}
function IngestJobCard({ job, busyAction, confirmRemove, onAction, onConfirmRemove }) {
    const progress = percent(job.progress, job.bytes_completed, job.bytes_total);
    return (_jsxs("article", { className: `ingest-job-card state-${job.state}`, children: [_jsx(CardCloseButton, { className: "ingest-job-remove", label: `Remove ${job.display_name || job.source_path} import job`, disabled: busyAction !== undefined, onClick: () => isTerminal(job.state)
                    ? onAction('ingest', job.id, job.state, 'remove')
                    : onConfirmRemove(jobKey('ingest', job.id)) }), _jsxs("div", { className: "ingest-job-heading", children: [_jsxs("div", { children: [_jsx("span", { className: "ingest-state", children: stateLabel(job.state) }), _jsx("h3", { children: job.display_name || job.source_path }), _jsx("p", { className: "ingest-source", title: job.source_path, children: job.source_path })] }), _jsx("strong", { className: "ingest-percent", children: progress === null ? '—' : `${Math.round(progress)}%` })] }), _jsx(Progress, { value: progress }), _jsxs("dl", { className: "ingest-job-stats", children: [_jsxs("div", { children: [_jsx("dt", { children: "Copied" }), _jsxs("dd", { children: [formatBytes(job.bytes_completed), " / ", formatBytes(job.bytes_total)] })] }), _jsxs("div", { children: [_jsx("dt", { children: "Files" }), _jsxs("dd", { children: [job.files_completed, " / ", job.files_total] })] }), _jsxs("div", { children: [_jsx("dt", { children: "Rate" }), _jsx("dd", { children: formatRate(job.rate_bytes_per_second) })] }), _jsxs("div", { children: [_jsx("dt", { children: "ETA" }), _jsx("dd", { children: formatEta(job.eta_seconds) })] })] }), job.current_file && _jsxs("p", { className: "ingest-current", children: ["Current: ", _jsx("span", { children: job.current_file })] }), job.error && _jsx("p", { className: "ingest-job-error", children: job.error }), _jsx(JobControls, { kind: "ingest", id: job.id, state: job.state, busyAction: busyAction, confirmRemove: confirmRemove, onAction: onAction, onConfirmRemove: onConfirmRemove })] }));
}
function TorrentJobCard({ job, linkedIngest, busyAction, confirmRemove, onAction, onConfirmRemove }) {
    const progress = percent(job.progress, job.bytes_completed, job.bytes_total);
    const displayState = linkedIngest?.state ?? job.state;
    const displayError = job.error || linkedIngest?.error;
    return (_jsxs("article", { className: `ingest-job-card state-${displayState}`, children: [_jsx(CardCloseButton, { className: "ingest-job-remove", label: `Remove ${job.name || 'torrent'} job`, disabled: busyAction !== undefined, onClick: () => isTerminal(job.state)
                    ? onAction('torrent', job.id, job.state, 'remove')
                    : onConfirmRemove(jobKey('torrent', job.id)) }), _jsxs("div", { className: "ingest-job-heading", children: [_jsxs("div", { children: [_jsx("span", { className: "ingest-state", children: stateLabel(displayState) }), _jsx("h3", { children: job.name || 'Torrent' }), job.info_hash && _jsx("p", { className: "ingest-source", children: job.info_hash })] }), _jsx("strong", { className: "ingest-percent", children: progress === null ? '—' : `${Math.round(progress)}%` })] }), _jsx(Progress, { value: progress }), job.ingest_job_id ? (_jsxs(_Fragment, { children: [_jsxs("dl", { className: "ingest-job-stats ingest-job-stats-import", children: [_jsxs("div", { children: [_jsx("dt", { children: "Copied" }), _jsxs("dd", { children: [formatBytes(job.bytes_completed), " / ", formatBytes(job.bytes_total)] })] }), _jsxs("div", { children: [_jsx("dt", { children: "Rate" }), _jsx("dd", { children: formatRate(job.download_rate) })] }), _jsxs("div", { children: [_jsx("dt", { children: "ETA" }), _jsx("dd", { children: formatEta(job.eta_seconds) })] })] }), torrentLifecycleMessage(job, linkedIngest) && _jsx("p", { className: "ingest-current", children: torrentLifecycleMessage(job, linkedIngest) })] })) : (_jsxs("dl", { className: "ingest-job-stats", children: [_jsxs("div", { children: [_jsx("dt", { children: "Received" }), _jsxs("dd", { children: [formatBytes(job.bytes_completed), " / ", formatBytes(job.bytes_total)] })] }), _jsxs("div", { children: [_jsx("dt", { children: "Down" }), _jsx("dd", { children: formatRate(job.download_rate) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Up" }), _jsx("dd", { children: formatRate(job.upload_rate) })] }), _jsxs("div", { children: [_jsx("dt", { children: "ETA" }), _jsx("dd", { children: formatEta(job.eta_seconds) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Peers" }), _jsx("dd", { children: job.peers })] }), _jsxs("div", { children: [_jsx("dt", { children: "Seeds" }), _jsx("dd", { children: job.seeds })] })] })), displayError && _jsx("p", { className: "ingest-job-error", children: displayError }), _jsx(JobControls, { kind: "torrent", id: job.id, state: job.state, busyAction: busyAction, confirmRemove: confirmRemove, onAction: onAction, onConfirmRemove: onConfirmRemove })] }));
}
export function IngestScreen({ api }) {
    const [snapshot, setSnapshot] = useState();
    const [path, setPath] = useState('');
    const [magnet, setMagnet] = useState('');
    const [loading, setLoading] = useState(true);
    const [busyByJob, setBusyByJob] = useState({});
    const [submitting, setSubmitting] = useState();
    const [error, setError] = useState();
    const [notice, setNotice] = useState();
    const [confirmRemove, setConfirmRemove] = useState();
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
            if (running)
                return;
            running = true;
            try {
                const value = await api.snapshot();
                if (active) {
                    setSnapshot(value);
                    setError(undefined);
                    setLoading(false);
                }
            }
            catch (reason) {
                if (active) {
                    setError(reason instanceof Error ? reason.message : String(reason));
                    setLoading(false);
                }
            }
            finally {
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
    const filesystemJobs = useMemo(() => snapshot?.ingestJobs.filter((job) => job.source_type !== 'torrent') ?? [], [snapshot?.ingestJobs]);
    const torrentJobs = useMemo(() => snapshot?.torrentJobs ?? [], [snapshot?.torrentJobs]);
    const submitPath = async (event) => {
        event.preventDefault();
        const value = path.trim();
        if (!value)
            return;
        setSubmitting('path');
        setError(undefined);
        setNotice(undefined);
        try {
            await api.submitPath(value);
            setPath('');
            setNotice(`Import queued: ${value}`);
            await refresh();
        }
        catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        }
        finally {
            setSubmitting(undefined);
        }
    };
    const submitMagnet = async (event) => {
        event.preventDefault();
        const value = magnet.trim();
        if (!value)
            return;
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
        }
        catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        }
        finally {
            setSubmitting(undefined);
        }
    };
    const act = useCallback(async (kind, id, state, action) => {
        const key = jobKey(kind, id);
        setBusyByJob((current) => ({ ...current, [key]: action }));
        setError(undefined);
        setNotice(undefined);
        try {
            if (kind === 'ingest') {
                if (action === 'pause')
                    await api.pauseIngest(id);
                else if (action === 'resume')
                    await api.resumeIngest(id);
                else {
                    if (!isTerminal(state))
                        await api.cancelIngest(id);
                    await api.clearIngest(id);
                }
            }
            else {
                if (action === 'pause')
                    await api.pauseTorrent(id);
                else if (action === 'resume')
                    await api.resumeTorrent(id);
                else {
                    if (!isTerminal(state))
                        await api.cancelTorrent(id);
                    await api.clearTorrent(id);
                }
            }
            if (action === 'remove')
                setConfirmRemove(undefined);
            await refresh();
        }
        catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        }
        finally {
            setBusyByJob((current) => {
                if (current[key] !== action)
                    return current;
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
    return (_jsxs("section", { className: "ingest-screen", children: [_jsxs("div", { className: "ingest-header", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Acquisition" }), _jsx("h1", { children: "Import" }), _jsx("p", { children: "Bring media into Macha from a server-side filesystem path or a BitTorrent magnet link." })] }), staging && (_jsxs("div", { className: "ingest-staging-summary", children: [_jsx("span", { children: "Staging" }), _jsxs("strong", { children: [formatBytes(staging.accounted_bytes), " / ", formatBytes(staging.limit_bytes)] }), _jsx("small", { title: staging.path, children: staging.path })] }))] }), _jsxs("div", { className: "ingest-submit-grid", children: [_jsxs("form", { className: "ingest-submit-card", onSubmit: (event) => { void submitMagnet(event); }, children: [_jsx("span", { className: "ingest-submit-label", children: "Torrent" }), _jsx("h2", { children: "Magnet link" }), _jsx("p", { children: "The server downloads into its configured staging area and submits the completed payload for import." }), _jsxs("div", { className: "ingest-submit-line", children: [_jsx("input", { "data-tv-focusable": "true", value: magnet, onChange: (event) => setMagnet(event.target.value), placeholder: "magnet:?xt=urn:btih:\u2026", disabled: !torrentEnabled || submitting === 'magnet' }), _jsx("button", { className: "primary-button", "data-tv-focusable": "true", type: "submit", disabled: !torrentEnabled || !magnet.trim() || Boolean(submitting), children: submitting === 'magnet' ? 'Adding…' : 'Add torrent' })] }), !torrentBuilt && snapshot && _jsx("p", { className: "ingest-disabled-note", children: "This server was built without libtorrent-rasterbar." }), torrentBuilt && !torrentEnabled && snapshot && _jsx("p", { className: "ingest-disabled-note", children: "Torrent acquisition is disabled in server configuration." })] }), _jsxs("form", { className: "ingest-submit-card", onSubmit: (event) => { void submitPath(event); }, children: [_jsx("span", { className: "ingest-submit-label", children: "Filesystem" }), _jsx("h2", { children: "File or folder path" }), _jsx("p", { children: "The path is on the Macha server, for example a mounted USB disk. Sources are preserved after a normal manual import." }), _jsxs("div", { className: "ingest-submit-line", children: [_jsx("input", { "data-tv-focusable": "true", value: path, onChange: (event) => setPath(event.target.value), placeholder: "/media/usb/Movies", disabled: !ingestEnabled || submitting === 'path' }), _jsx("button", { className: "primary-button", "data-tv-focusable": "true", type: "submit", disabled: !ingestEnabled || !path.trim() || Boolean(submitting), children: submitting === 'path' ? 'Adding…' : 'Start import' })] }), !ingestEnabled && snapshot && _jsx("p", { className: "ingest-disabled-note", children: "Filesystem import is disabled in server configuration." })] })] }), error && _jsx("p", { className: "ingest-page-error", role: "alert", children: error }), notice && _jsx("p", { className: "ingest-page-notice", children: notice }), loading && !snapshot && _jsx("p", { className: "ingest-loading", children: "Loading import state\u2026" }), _jsxs("section", { className: "ingest-job-section", children: [_jsxs("div", { className: "ingest-section-heading", children: [_jsx("h2", { children: "Torrents" }), _jsx("span", { children: torrentJobs.length })] }), _jsxs("div", { className: "ingest-job-list", children: [torrentJobs.map((job) => (_jsx(TorrentJobCard, { job: job, linkedIngest: job.ingest_job_id ? snapshot?.ingestJobs.find((candidate) => candidate.id === job.ingest_job_id) : undefined, busyAction: busyByJob[jobKey('torrent', job.id)], confirmRemove: confirmRemove === jobKey('torrent', job.id), onAction: (kind, id, state, action) => { void act(kind, id, state, action); }, onConfirmRemove: setConfirmRemove }, job.id))), snapshot && torrentJobs.length === 0 && _jsx("p", { className: "ingest-empty", children: "No torrent jobs." })] })] }), _jsxs("section", { className: "ingest-job-section", children: [_jsxs("div", { className: "ingest-section-heading", children: [_jsx("h2", { children: "File and folder imports" }), _jsx("span", { children: filesystemJobs.length })] }), _jsxs("div", { className: "ingest-job-list", children: [filesystemJobs.map((job) => (_jsx(IngestJobCard, { job: job, busyAction: busyByJob[jobKey('ingest', job.id)], confirmRemove: confirmRemove === jobKey('ingest', job.id), onAction: (kind, id, state, action) => { void act(kind, id, state, action); }, onConfirmRemove: setConfirmRemove }, job.id))), snapshot && filesystemJobs.length === 0 && _jsx("p", { className: "ingest-empty", children: "No filesystem import jobs." })] })] })] }));
}
