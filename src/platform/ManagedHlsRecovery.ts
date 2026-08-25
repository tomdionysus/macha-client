export type ManagedHlsMediaRecoveryDecision =
  | { action: 'recover'; attempt: number }
  | { action: 'fail'; reason: 'no-progress-after-recovery' | 'recovery-budget-exhausted'; attempts: number };

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
  private progressSinceRecoveryMs = 0;
  private lastObservedPositionMs?: number;

  constructor(
    private readonly maxRecoveries = 2,
    private readonly requiredProgressMs = 2_000,
  ) {}

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
