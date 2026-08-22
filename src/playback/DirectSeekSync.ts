import type { PlaybackSession } from './PlaybackResolver';

export interface DirectSeekSyncRequest {
  sessionId: string;
  positionMs: number;
  sequence: number;
}

type SessionUpdater = (sessionId: string, positionMs: number) => Promise<PlaybackSession>;
type SessionApplied = (session: PlaybackSession, request: DirectSeekSyncRequest) => void;
type SessionFailed = (error: unknown, request: DirectSeekSyncRequest) => void;

/**
 * Coalesces optimistic Direct Play seeks into serialized playback-session
 * mutations. Local playback never waits for this synchronizer: it exists only
 * to make the server-side session eventually reflect the browser's position.
 */
export class DirectSeekSessionSync {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: DirectSeekSyncRequest | undefined;
  private inFlight = false;
  private sequence = 0;
  private disposed = false;

  constructor(
    private readonly update: SessionUpdater,
    private readonly onApplied: SessionApplied,
    private readonly onFailed: SessionFailed,
    private readonly debounceMs = 180,
  ) {}

  schedule(sessionId: string, positionMs: number): number {
    if (this.disposed) return this.sequence;
    const sequence = ++this.sequence;
    this.pending = {
      sessionId,
      positionMs: Math.max(0, Math.round(positionMs)),
      sequence,
    };
    if (!this.inFlight) this.arm(this.debounceMs);
    return sequence;
  }

  /** Drop queued work when another server-side playback mutation supersedes it. */
  clearPending(): void {
    this.sequence += 1;
    this.pending = undefined;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.clearPending();
  }

  private arm(delayMs: number): void {
    if (this.disposed || this.inFlight || !this.pending) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, Math.max(0, delayMs));
  }

  private async flush(): Promise<void> {
    if (this.disposed || this.inFlight || !this.pending) return;
    const request = this.pending;
    this.pending = undefined;
    this.inFlight = true;
    try {
      const session = await this.update(request.sessionId, request.positionMs);
      if (!this.disposed && request.sequence === this.sequence && !this.pending) {
        this.onApplied(session, request);
      }
    } catch (error) {
      if (!this.disposed) this.onFailed(error, request);
    } finally {
      this.inFlight = false;
      // A seek that arrived while the previous PATCH was running has already
      // spent time waiting, so send the latest one immediately rather than
      // applying another debounce interval.
      if (!this.disposed && this.pending) this.arm(0);
    }
  }
}
