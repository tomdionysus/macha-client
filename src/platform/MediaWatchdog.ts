/**
 * Bounds the one playback failure the player could not previously see: a media
 * element that accepted a source, began its fetch, and then received nothing
 * at all — ever.
 *
 * Every other deadline in this client covers a *server request*: the session
 * POST and PATCH, the endpoint deadlines, the API layer's own request timeout,
 * the HLS standby preflight. Once `video.src` is assigned, nothing watched
 * whether the element got anywhere, because every failure and degradation
 * channel is driven by something the element *emits* — a `MediaError`, an
 * hls.js error, a read-ahead worker failure. An element sitting silently at
 * `HAVE_NOTHING` emits none of those, so this fault shape walked straight past
 * the entire cluster-failover apparatus that exists precisely for "this node
 * is not delivering bytes", and the viewer got an unchanging spinner for as
 * long as they were willing to watch it (four minutes, on the report that
 * prompted this).
 *
 * That is an unbounded wait, which `docs/principles-and-laws.md` forbids
 * outright: failure and degraded states must be visible and actionable rather
 * than becoming indefinite waiting. This bound holds whatever the underlying
 * cause turns out to be, which is the point — the cause is still open.
 *
 * Two things keep it honest rather than making it a blunt timer.
 *
 * **It triggers on zero bytes, never on "slow".** A media element fires
 * `progress` as data arrives, well before `readyState` climbs off
 * `HAVE_NOTHING`, so a link that is merely bad — and one node here is
 * deliberately across a saturated WAN — cancels this watch on its first few
 * bytes and is never judged. Only a source that has delivered literally
 * nothing can reach the deadline.
 *
 * **Only visible time counts.** Chromium throttles media loading in a
 * backgrounded or occluded tab, and a tab that is not loading because nobody
 * is looking at it is the browser working correctly, not a node failing. That
 * distinction is not hypothetical here: it is the confound that invalidated a
 * whole evening's investigation of this bug, where screenshots kept rendering
 * a tab Chromium had backgrounded. Pausing the clock while hidden means a
 * fired watchdog is evidence of a real fault, and stops us burning every
 * candidate node to reach a fatal error screen on a tab the viewer had simply
 * switched away from.
 */

/**
 * How long a source may hold the element without delivering one byte.
 *
 * Deliberately generous. The failure this bounds is unbounded today, so
 * anything finite is the whole improvement; buying that with needless node
 * churn on a slow-but-working start would be a poor trade. Twenty seconds of
 * *visible* time with zero bytes is not a slow link, it is a dead one.
 */
export const MEDIA_START_STARVATION_MS = 20_000;

export interface MediaWatchdogEnvironment {
  now(): number;
  /**
   * Whether the page is being displayed. Only an explicit `hidden` counts as
   * not visible: `prerender` and a host with no `document` at all must leave
   * the bound in force rather than silently disabling it.
   */
  visible(): boolean;
  /** Subscribe to visibility transitions. Returns an unsubscribe. */
  onVisibilityChange(listener: () => void): () => void;
  /** Schedule work. Returns a cancel function, so no handle type escapes. */
  schedule(callback: () => void, delayMs: number): () => void;
}

export const browserMediaWatchdogEnvironment: MediaWatchdogEnvironment = {
  now: () => Date.now(),
  visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  // A host that cannot report visibility is treated as permanently visible, so
  // the bound stays in force rather than being silently disabled by a missing
  // API. The `undefined` check above and this one are the same decision and
  // have to agree: guarding only one of them leaves the module claiming not to
  // require a DOM while still throwing on hosts that do not fully provide one.
  onVisibilityChange: (listener) => {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
      return () => undefined;
    }
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener?.('visibilitychange', listener);
  },
  schedule: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};

/**
 * A deadline measured in *visible* time, which both watchdogs need and neither
 * should reimplement.
 *
 * Chromium throttles media loading in a backgrounded or occluded tab, and a TV
 * app sent to the home screen is not playing either. Time spent that way is
 * the platform working correctly rather than a node failing, so it counts
 * toward no deadline here.
 */
class VisibleDeadline {
  private cancelTimer?: () => void;
  private unsubscribeVisibility?: () => void;
  private expired?: (visibleMs: number) => void;
  /** Visible milliseconds banked from segments that have already ended. */
  private bankedMs = 0;
  /** When the current visible segment began, or undefined while hidden. */
  private segmentStartedAt?: number;

  constructor(
    private readonly timeoutMs: number,
    private readonly environment: MediaWatchdogEnvironment,
  ) {}

  get running(): boolean { return this.expired !== undefined; }

  arm(expired: (visibleMs: number) => void): void {
    this.disarm();
    this.expired = expired;
    this.unsubscribeVisibility = this.environment.onVisibilityChange(() => this.syncVisibility());
    this.syncVisibility();
  }

  /** Restart the countdown while keeping the visibility subscription. */
  restart(): void {
    if (!this.expired) return;
    this.bankedMs = 0;
    this.segmentStartedAt = undefined;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.syncVisibility();
  }

  disarm(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = undefined;
    this.expired = undefined;
    this.bankedMs = 0;
    this.segmentStartedAt = undefined;
  }

  /** Visible milliseconds accrued so far, banked plus the open segment. */
  private elapsedMs(): number {
    const open = this.segmentStartedAt === undefined ? 0 : this.environment.now() - this.segmentStartedAt;
    return this.bankedMs + open;
  }

  private syncVisibility(): void {
    if (!this.expired) return;
    const visible = this.environment.visible();
    if (visible && this.segmentStartedAt === undefined) {
      this.segmentStartedAt = this.environment.now();
      this.cancelTimer?.();
      this.cancelTimer = this.environment.schedule(
        () => this.expire(),
        Math.max(0, this.timeoutMs - this.bankedMs),
      );
      return;
    }
    if (!visible && this.segmentStartedAt !== undefined) {
      this.bankedMs += this.environment.now() - this.segmentStartedAt;
      this.segmentStartedAt = undefined;
      this.cancelTimer?.();
      this.cancelTimer = undefined;
    }
  }

  private expire(): void {
    const expired = this.expired;
    const visibleMs = this.elapsedMs();
    this.cancelTimer = undefined;
    // Tear down before notifying: the callback fails the source generation,
    // which must not be able to re-enter a deadline that is still armed.
    this.disarm();
    expired?.(visibleMs);
  }
}

/**
 * The start watchdog: a source the element accepted and never got a byte from.
 *
 * Triggers on *zero bytes ever*, never on "slow" — a media element fires
 * `progress` as data arrives, well before `readyState` leaves `HAVE_NOTHING`,
 * so a merely bad link cancels this on its first few bytes and is never judged.
 */
export class MediaStartWatchdog {
  private readonly deadline: VisibleDeadline;

  constructor(
    timeoutMs: number = MEDIA_START_STARVATION_MS,
    environment: MediaWatchdogEnvironment = browserMediaWatchdogEnvironment,
  ) {
    this.deadline = new VisibleDeadline(timeoutMs, environment);
  }

  start(starved: (visibleMs: number) => void): void {
    this.deadline.arm(starved);
  }

  /** Evidence that bytes reached the element. Idempotent; safe when idle. */
  noteProgress(): void {
    this.deadline.disarm();
  }

  stop(): void {
    this.deadline.disarm();
  }
}

/**
 * How long a picture may sit frozen with nothing arriving before the source is
 * called dead.
 *
 * Set against a measurement rather than a feeling: on 2026-09-08 a node that
 * was working — merely producing a transcode slower than realtime — delivered
 * in bursts separated by **seven seconds** of no progress at all. A threshold
 * near that would evict healthy nodes under load. This is comfortably clear of
 * it, and still far short of the thirty seconds an operator sat through
 * watching a frozen frame with nothing detecting it.
 */
export const MEDIA_STALL_TIMEOUT_MS = 15_000;

/**
 * The stall watchdog: playback stopped and nothing is arriving to restart it.
 *
 * The reason this exists is that failover already works — `PlaybackCoordinator`
 * recovers a `'stream'` failure onto another node — and on a platform whose
 * player reports nothing, no one ever tells it to. A Samsung set had a frame
 * frozen for thirty seconds with every recovery mechanism intact and idle,
 * because its native HLS player swallowed the failure and the element's
 * `error` event is the only channel that platform has.
 *
 * **Position alone is the wrong signal, and this is the whole design.** A node
 * producing a transcode below realtime freezes the picture repeatedly while
 * remaining perfectly healthy — bytes keep arriving, the buffer keeps growing,
 * playback simply cannot keep ahead. Judging on a stopped clock would evict
 * exactly the node that was doing the work. So a stall is only evidence when
 * the buffer has stopped growing too: nothing playing *and* nothing arriving.
 * Slow is a buffer that advances while the picture waits; dead is neither.
 *
 * Deliberately player-agnostic — `currentTime` and `buffered` are all it reads,
 * so it works behind hls.js, behind a television's native HLS player, and
 * behind a progressive file alike. That matters because the platforms most
 * likely to swallow a failure are the ones least able to report it.
 */
export class MediaStallWatchdog {
  private readonly deadline: VisibleDeadline;
  private stalled?: (detail: { visibleMs: number; positionMs: number; bufferedEndMs: number }) => void;
  private lastPositionMs?: number;
  private lastBufferedEndMs?: number;

  constructor(
    timeoutMs: number = MEDIA_STALL_TIMEOUT_MS,
    environment: MediaWatchdogEnvironment = browserMediaWatchdogEnvironment,
  ) {
    this.deadline = new VisibleDeadline(timeoutMs, environment);
  }

  /**
   * Watch a generation that has started playing. Nothing is armed until the
   * first `note()`, so a source still loading is the start watchdog's business
   * and cannot be judged twice.
   */
  watch(stalled: (detail: { visibleMs: number; positionMs: number; bufferedEndMs: number }) => void): void {
    this.stop();
    this.stalled = stalled;
  }

  /**
   * Report where playback is and how far the buffer reaches. Either advancing
   * restarts the countdown; neither advancing lets it run.
   */
  note(positionMs: number, bufferedEndMs: number): void {
    if (!this.stalled) return;
    const advanced = this.lastPositionMs === undefined
      || positionMs > this.lastPositionMs
      || bufferedEndMs > (this.lastBufferedEndMs ?? 0);
    this.lastPositionMs = positionMs;
    this.lastBufferedEndMs = Math.max(bufferedEndMs, this.lastBufferedEndMs ?? 0);
    if (!this.deadline.running) {
      const stalled = this.stalled;
      this.deadline.arm((visibleMs) => {
        this.stop();
        stalled({ visibleMs, positionMs: this.lastPositionMs ?? positionMs, bufferedEndMs: this.lastBufferedEndMs ?? bufferedEndMs });
      });
      return;
    }
    if (advanced) this.deadline.restart();
  }

  /** Paused is not stalled: the viewer stopped it on purpose. */
  suspend(): void {
    this.deadline.disarm();
  }

  stop(): void {
    this.deadline.disarm();
    this.stalled = undefined;
    this.lastPositionMs = undefined;
    this.lastBufferedEndMs = undefined;
  }
}
