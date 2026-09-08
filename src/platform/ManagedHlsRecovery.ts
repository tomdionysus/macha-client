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
 * Per-source-generation recovery budget for fatal hls.js media errors.
 *
 * A recovery is useful only if it produces observable playback progress. The
 * guard therefore permits one immediate MediaSource recovery, requires real
 * timeline advancement before another, and has a hard per-generation ceiling.
 * A new playback source gets a new guard; pause/resume does not.
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
   * A media error hls.js calls non-fatal, raised while nothing has buffered.
   *
   * hls.js recovers from some of these itself, without ever asking us: an
   * append against a MediaSource the browser has ended is answered by tearing
   * the MediaSource down and building another. When the stream is one this
   * browser cannot parse at all, that recovery reaches the same wall every
   * time and the player sits in a loop — one full segment refetched per turn,
   * for as long as the viewer leaves it there. Observed against a real title:
   * fifty-eight refetches of the same 2.4 MB segment in forty-six seconds, a
   * spinner throughout, and nothing in the UI to say anything was wrong.
   *
   * "Non-fatal" is a claim about recoverability, and repetition with nothing
   * buffered is the evidence against it. Bounded here rather than left to
   * hls.js, which has no view of whether its own recoveries achieve anything.
   */
  unbufferedMediaError(): ManagedHlsUnbufferedMediaDecision {
    this.unbufferedMediaErrors += 1;
    return this.unbufferedMediaErrors >= this.maxUnbufferedMediaErrors
      ? { action: 'fail', occurrences: this.unbufferedMediaErrors }
      : { action: 'ignore', occurrences: this.unbufferedMediaErrors };
  }

  /** Anything buffered means the pipeline is working; the streak starts again. */
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
