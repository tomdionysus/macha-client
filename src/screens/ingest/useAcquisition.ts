import { useCallback, useState } from 'react';
import { type AcquisitionApi, type AcquisitionSnapshot } from '@machafoundation/core';
import { usePollingTask } from '../../hooks/usePollingTask';
import { runBulkOperation } from '../../components/ListParts';
import { isTerminal, jobKey, type JobAction, type JobKind } from './jobs';
import { viewerErrorText } from '../../text/viewerText';

/** One action on one job, as the server's calls. A remove cancels a job that is still running, then clears it. */
async function perform(api: AcquisitionApi, kind: JobKind, id: string, state: string, action: JobAction): Promise<void> {
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
}

const bulkVerb: Record<JobAction, string> = { pause: 'paused', resume: 'resumed', retry: 'retried', remove: 'removed' };

/**
 * The acquisition state and the actions on it, shared by the job list and a
 * torrent's own page so the two cannot disagree about what a remove does.
 */
export function useAcquisition(api: AcquisitionApi) {
  const [snapshot, setSnapshot] = useState<AcquisitionSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busyByJob, setBusyByJob] = useState<Record<string, JobAction>>({});
  const [confirmRemove, setConfirmRemove] = useState<string>();

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
      setError(viewerErrorText(reason));
      setLoading(false);
    },
    intervalMs: 1500,
    dependencies: [api],
  });

  /** Runs one action on one job. Answers whether it succeeded. */
  const act = useCallback(async (kind: JobKind, id: string, state: string, action: JobAction): Promise<boolean> => {
    const key = jobKey(kind, id);
    setBusyByJob((current) => ({ ...current, [key]: action }));
    setError(undefined);
    setNotice(undefined);
    try {
      await perform(api, kind, id, state, action);
      if (action === 'remove') setConfirmRemove(undefined);
      await refresh();
      return true;
    } catch (reason: unknown) {
      setError(viewerErrorText(reason));
      return false;
    } finally {
      setBusyByJob((current) => {
        if (current[key] !== action) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }, [api, refresh]);

  /**
   * Runs one action on many jobs at once, each row busy while it runs, and
   * says how many the server refused. Answers whether all of them succeeded.
   */
  const actMany = useCallback(async (kind: JobKind, jobs: ReadonlyArray<{ id: string; state: string }>, action: JobAction): Promise<boolean> => {
    if (jobs.length === 0) return true;
    const keys = jobs.map((job) => jobKey(kind, job.id));
    setBusyByJob((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, action])) }));
    setError(undefined);
    setNotice(undefined);
    const states = new Map(jobs.map((job) => [job.id, job.state]));
    const failed = await runBulkOperation(jobs.map((job) => job.id), (id) => perform(api, kind, id, states.get(id) ?? '', action));
    try {
      await refresh();
    } catch (reason: unknown) {
      setError(viewerErrorText(reason));
    }
    if (failed) setError(`${failed} of ${jobs.length} ${kind === 'torrent' ? 'torrents' : 'imports'} could not be ${bulkVerb[action]}.`);
    setBusyByJob((current) => {
      const next = { ...current };
      for (const key of keys) if (next[key] === action) delete next[key];
      return next;
    });
    return failed === 0;
  }, [api, refresh]);

  return { snapshot, loading, error, setError, notice, setNotice, refresh, busyByJob, confirmRemove, setConfirmRemove, act, actMany };
}
