export type ManagedHlsMediaRecoveryDecision =
  | { action: 'recover'; attempt: number }
  | { action: 'fail'; reason: 'no-progress-after-recovery' | 'recovery-budget-exhausted'; attempts: number };

export type ManagedHlsNetworkRecoveryDecision =
  | { action: 'restart'; attempt: number }
  | { action: 'fail'; attempts: number };

export type ManagedHlsUnbufferedMediaDecision =
  | { action: 'ignore'; occurrences: number }
  | { action: 'fail'; occurrences: number };

/**
 * Recovery budget for one playback source; pause and resume keep it. Allows one
 * immediate media recovery, then requires timeline progress before another.
 */
export class ManagedHlsMediaRecoveryBudget {
  private attempts = 0;
  private networkRestarts = 0;
  private progressSinceRecoveryMs = 0;
  private lastObservedPositionMs?: number;
  private unbufferedMediaErrors = 0;

  constructor(
    private readonly maxRecoveries = 2,
    private readonly requiredProgressMs = 2_000,
    private readonly maxNetworkRestarts = 1,
    private readonly maxUnbufferedMediaErrors = 6,
  ) {}

  /**
   * A non-fatal media error with nothing buffered. hls.js retries these itself,
   * refetching a segment each time, so a stream the browser cannot parse loops
   * behind a spinner unless bounded here.
   */
  unbufferedMediaError(): ManagedHlsUnbufferedMediaDecision {
    this.unbufferedMediaErrors += 1;
    return this.unbufferedMediaErrors >= this.maxUnbufferedMediaErrors
      ? { action: 'fail', occurrences: this.unbufferedMediaErrors }
      : { action: 'ignore', occurrences: this.unbufferedMediaErrors };
  }

  /** Buffered content resets the unbuffered-error streak. */
  observeBufferedContent(): void {
    this.unbufferedMediaErrors = 0;
  }

  fatalNetworkError(): ManagedHlsNetworkRecoveryDecision {
    if (this.networkRestarts >= this.maxNetworkRestarts) {
      return { action: 'fail', attempts: this.networkRestarts };
    }
    this.networkRestarts += 1;
    return { action: 'restart', attempt: this.networkRestarts };
  }

  observePlaybackPosition(positionMs: number, progressing: boolean): void {
    if (!Number.isFinite(positionMs)) return;
    const bounded = Math.max(0, positionMs);
    const previous = this.lastObservedPositionMs;
    this.lastObservedPositionMs = bounded;
    if (!progressing || this.attempts === 0 || previous === undefined) return;
    const delta = bounded - previous;
    // Ignore backwards movement and large discontinuities (user/source seeks).
    if (delta > 0 && delta <= 5_000) this.progressSinceRecoveryMs += delta;
  }

  fatalMediaError(positionMs: number): ManagedHlsMediaRecoveryDecision {
    if (this.attempts > 0 && this.progressSinceRecoveryMs < this.requiredProgressMs) {
      return { action: 'fail', reason: 'no-progress-after-recovery', attempts: this.attempts };
    }
    if (this.attempts >= this.maxRecoveries) {
      return { action: 'fail', reason: 'recovery-budget-exhausted', attempts: this.attempts };
    }
    this.attempts += 1;
    this.progressSinceRecoveryMs = 0;
    this.lastObservedPositionMs = Number.isFinite(positionMs) ? Math.max(0, positionMs) : undefined;
    return { action: 'recover', attempt: this.attempts };
  }
}
