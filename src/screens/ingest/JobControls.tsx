import { canPause, canResume, isTerminal, jobKey, type JobAction, type JobKind } from './jobs';

export function Progress({ value }: { value: number | null }) {
  return (
    <div className="ingest-progress-track" aria-hidden="true">
      <span className={value === null ? 'indeterminate' : undefined} style={value === null ? undefined : { width: `${value}%` }} />
    </div>
  );
}

/**
 * Pause, resume, retry and remove for one job.
 *
 * `row` is the slim form for a list line: one toggle and a remove, with the
 * remove asking once inline. `page` is the full set with words, for a job's own
 * page. Removing a job that is still running cancels it first, so it always
 * asks; removing one that has finished only clears it, so it does not.
 */
export function JobControls({ variant, kind, id, name, state, retryable = false, busyAction, confirming, onAction, onConfirm }: {
  variant: 'row' | 'page';
  kind: JobKind;
  id: string;
  name: string;
  state: string;
  retryable?: boolean;
  busyAction: JobAction | undefined;
  confirming: boolean;
  onAction: (action: JobAction) => void;
  onConfirm: (key: string | undefined) => void;
}) {
  const busy = busyAction !== undefined;
  const pending = (action: JobAction, idle: string, working: string) => (busyAction === action ? working : idle);
  const remove = () => (isTerminal(state) ? onAction('remove') : onConfirm(jobKey(kind, id)));

  if (confirming) {
    return (
      <div className={`ingest-job-actions ingest-job-actions-${variant}`}>
        <span className="ingest-confirm-label">{variant === 'row' ? 'Remove?' : 'Cancel and remove this job?'}</span>
        <button type="button" className="secondary-button ingest-delete-button confirm" data-tv-focusable="true" disabled={busy} onClick={() => onAction('remove')}>
          {pending('remove', 'Remove', 'Removing…')}
        </button>
        <button type="button" className="secondary-button" data-tv-focusable="true" disabled={busy} onClick={() => onConfirm(undefined)}>
          Keep
        </button>
      </div>
    );
  }

  return (
    <div className={`ingest-job-actions ingest-job-actions-${variant}`}>
      {canPause(kind, state) && (
        <button type="button" className="secondary-button" data-tv-focusable="true" disabled={busy} aria-label={`Pause ${name}`} onClick={() => onAction('pause')}>
          {pending('pause', 'Pause', 'Pausing…')}
        </button>
      )}
      {canResume(kind, state) && (
        <button type="button" className="secondary-button" data-tv-focusable="true" disabled={busy} aria-label={`Resume ${name}`} onClick={() => onAction('resume')}>
          {pending('resume', 'Resume', 'Resuming…')}
        </button>
      )}
      {retryable && (
        <button type="button" className="secondary-button" data-tv-focusable="true" disabled={busy} aria-label={`Retry importing ${name}`} onClick={() => onAction('retry')}>
          {pending('retry', 'Retry import', 'Retrying…')}
        </button>
      )}
      <button
        type="button"
        className={`secondary-button ingest-delete-button${variant === 'row' ? ' ingest-remove-compact' : ''}`}
        data-tv-focusable="true"
        disabled={busy}
        aria-label={`Remove ${name}`}
        title={`Remove ${name}`}
        onClick={remove}
      >
        {variant === 'row' ? <span aria-hidden="true">×</span> : pending('remove', 'Remove', 'Removing…')}
      </button>
    </div>
  );
}
