import { useCallback, useState } from 'react';
import { errorMessage, type AcquisitionApi, type AcquisitionSnapshot } from '@machafoundation/core';
import { usePollingTask } from '../../hooks/usePollingTask';
import { isTerminal, jobKey, type JobAction, type JobKind } from './jobs';

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
      setError(errorMessage(reason));
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
      return true;
    } catch (reason: unknown) {
      setError(errorMessage(reason));
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

  return { snapshot, loading, error, setError, notice, setNotice, refresh, busyByJob, confirmRemove, setConfirmRemove, act };
}
