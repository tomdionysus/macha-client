import { createClientLogger } from '../diagnostics/ClientLog';
import type { Player } from '../platform/Platform';
import type { MediaSummary, PlaybackCapabilities, PlaybackEvent } from '../types';
import type {
  PlaybackPreferencesUpdate,
  PlaybackResolver,
  PlaybackSession,
  PlaybackStopOptions,
  PlaybackUpdate,
} from './PlaybackResolver';

export interface PlaybackIntent {
  positionMs: number;
  paused: boolean;
}

export interface PlaybackCoordinatorSnapshot {
  intent: PlaybackIntent;
  event: PlaybackEvent;
  session?: PlaybackSession;
  starting: boolean;
  preparingSource: boolean;
  fatalError?: Error;
  notice?: string;
}

export interface PlaybackCoordinatorOptions {
  media: MediaSummary;
  player: Player;
  resolver: PlaybackResolver;
  capabilities: () => Promise<PlaybackCapabilities>;
  initialPositionMs: number;
  initialPreferences?: PlaybackPreferencesUpdate;
}

type Listener = (snapshot: PlaybackCoordinatorSnapshot) => void;

interface PendingMutation {
  update: PlaybackUpdate;
  reason: 'seek' | 'representation' | 'subtitle';
}

function clampPosition(positionMs: number, durationMs: number | undefined): number {
  const finite = Number.isFinite(positionMs) ? positionMs : 0;
  if (!durationMs || durationMs <= 0) return Math.max(0, finite);
  return Math.max(0, Math.min(durationMs, finite));
}

export function generationLocalPosition(
  session: PlaybackSession,
  absolutePositionMs: number,
): number | undefined {
  if (session.mode === 'direct') return clampPosition(absolutePositionMs, session.durationMs);
  const generationStartMs = Math.max(0, session.seekMs);
  if (absolutePositionMs < generationStartMs) return undefined;
  return clampPosition(absolutePositionMs - generationStartMs, Math.max(0, session.durationMs - generationStartMs));
}

function rangeContainsPosition(
  ranges: readonly { startMs: number; endMs: number }[],
  positionMs: number,
): boolean {
  return ranges.some((range) => range.startMs <= positionMs && positionMs <= range.endMs);
}

function mergePreferences(
  current: PlaybackPreferencesUpdate | undefined,
  next: PlaybackPreferencesUpdate | undefined,
): PlaybackPreferencesUpdate | undefined {
  if (!current) return next ? { ...next } : undefined;
  if (!next) return { ...current };
  return { ...current, ...next };
}

export function mergePlaybackUpdate(current: PlaybackUpdate | undefined, next: PlaybackUpdate): PlaybackUpdate {
  if (!current) return {
    ...next,
    preferences: next.preferences ? { ...next.preferences } : undefined,
  };
  return {
    ...current,
    ...next,
    preferences: mergePreferences(current.preferences, next.preferences),
  };
}

export function isSubtitleOnlyPlaybackUpdate(update: PlaybackUpdate): boolean {
  if (update.seekMs !== undefined || update.mediaId !== undefined || !update.preferences) return false;
  const keys = Object.entries(update.preferences)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  return keys.length > 0 && keys.every((key) => key === 'subtitleStream' || key === 'subtitleLanguage');
}

function sourceIdentity(session: PlaybackSession): string {
  return `${session.mode}|${session.source.url}|${session.source.mimeType ?? ''}|${session.mediaId}`;
}

function preservedSeekPreferences(session: PlaybackSession): PlaybackPreferencesUpdate {
  return {
    subtitleStream: session.selected.subtitleStream >= 0 ? session.selected.subtitleStream : null,
    subtitleLanguage: session.preferences.subtitleLanguage,
  };
}

/**
 * PlaybackCoordinator is the sole owner of playback intent and source-generation
 * transitions. Transport commands are always local and immediate when the active
 * generation can represent them. Server work is restricted to creating/replacing
 * source generations and is coalesced behind the latest user intent.
 */
export class PlaybackCoordinator {
  private readonly log: ReturnType<typeof createClientLogger>;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribePlayer: () => void;
  private readonly unsubscribePlayerFailure?: () => void;
  private disposed = false;
  private startPromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private closeOptions: PlaybackStopOptions = {};
  private mutationLoop?: Promise<void>;
  private pendingMutation?: PendingMutation;
  private mutationRevision = 0;
  private sourceActivationRevision = 0;
  private positionRevision = 0;
  private seekIntentActive = false;
  private streamOffsetMs = 0;
  /** Latest server-side session state; may be ahead of the source currently visible. */
  private serverSession?: PlaybackSession;

  private snapshot: PlaybackCoordinatorSnapshot;

  constructor(private readonly options: PlaybackCoordinatorOptions) {
    this.log = createClientLogger('playback.coordinator', { mediaId: options.media.id });
    const initialPositionMs = Math.max(0, options.initialPositionMs);
    this.snapshot = {
      intent: { positionMs: initialPositionMs, paused: false },
      event: {
        positionMs: initialPositionMs,
        durationMs: options.media.durationMs ?? 0,
        paused: true,
        ended: false,
      },
      starting: true,
      preparingSource: false,
    };
    this.unsubscribePlayer = options.player.subscribe((event) => this.onPlayerEvent(event));
    this.unsubscribePlayerFailure = options.player.subscribeFailure?.((error) => this.fail(error));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): PlaybackCoordinatorSnapshot {
    return {
      ...this.snapshot,
      intent: { ...this.snapshot.intent },
      event: { ...this.snapshot.event },
    };
  }

  start(): Promise<void> {
    if (!this.startPromise) this.startPromise = this.startInternal();
    return this.startPromise;
  }

  private async startInternal(): Promise<void> {
    if (this.disposed) return;
    const startedAt = performance.now();
    try {
      const capabilities = await this.options.capabilities();
      if (this.disposed) return;
      const requestedPositionMs = this.snapshot.intent.positionMs;
      const requestedPositionRevision = this.positionRevision;
      const session = await this.options.resolver.resolve(
        this.options.media,
        capabilities,
        requestedPositionMs,
        this.options.initialPreferences,
      );
      if (this.disposed) {
        await this.options.resolver.stop(session.sessionId, this.closeOptions).catch(() => undefined);
        return;
      }
      this.log.info('initial-generation-ready', {
        sessionId: session.sessionId,
        mode: session.mode,
        requestedPositionMs,
        serverSeekMs: session.seekMs,
        elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
      });
      this.serverSession = session;

      const currentDesired = this.snapshot.intent.positionMs;
      const userMovedDuringResolve = requestedPositionRevision !== this.positionRevision;
      if (userMovedDuringResolve && this.activationPosition(session, currentDesired, requestedPositionMs) === undefined) {
        this.queueMutation({
          reason: 'seek',
          update: {
            seekMs: currentDesired,
            preferences: preservedSeekPreferences(session),
          },
        });
      } else {
        // A transformed server may keyframe-align the requested generation after
        // the exact requested point. When this is the generation we explicitly
        // requested, accept that alignment rather than creating a retry loop.
        this.activateSession(session, currentDesired, requestedPositionMs);
      }
    } catch (error) {
      this.fail(error);
    } finally {
      if (!this.disposed) {
        this.patchSnapshot({ starting: false });
      }
    }
  }

  close(options: PlaybackStopOptions = {}): Promise<void> {
    if (options.keepalive) this.closeOptions = { ...this.closeOptions, keepalive: true };
    if (this.closePromise) return this.closePromise;

    this.disposed = true;
    this.mutationRevision += 1;
    this.sourceActivationRevision += 1;
    this.pendingMutation = undefined;
    this.unsubscribePlayer();
    this.unsubscribePlayerFailure?.();
    // Coordinator teardown ends source acquisition immediately, but deliberately
    // leaves DOM-host ownership to PlaybackRuntime/PlayerHost.
    this.options.player.stop();
    const ownedAtClose = this.serverSession ?? this.snapshot.session;

    this.closePromise = (async () => {
      await this.startPromise?.catch(() => undefined);
      await this.mutationLoop?.catch(() => undefined);
      const session = this.serverSession ?? this.snapshot.session ?? ownedAtClose;
      if (session) {
        try {
          await this.options.resolver.stop(session.sessionId, this.closeOptions);
        } catch (error) {
          this.log.warn('session-close-failed', { sessionId: session.sessionId, error });
        }
      }
      this.listeners.clear();
    })();
    return this.closePromise;
  }

  ownedSessionId(): string | undefined {
    return (this.serverSession ?? this.snapshot.session)?.sessionId;
  }

  setPaused(paused: boolean): void {
    if (this.disposed) return;
    const intent = { ...this.snapshot.intent, paused };
    this.patchSnapshot({ intent });
    if (paused) this.options.player.pause();
    else this.options.player.resume();
    this.log.info(paused ? 'pause-intent' : 'play-intent', {
      sessionId: this.snapshot.session?.sessionId,
      positionMs: intent.positionMs,
    });
  }

  seek(positionMs: number): boolean {
    if (this.disposed) return false;
    const durationMs = this.snapshot.session?.durationMs || this.snapshot.event.durationMs || this.options.media.durationMs;
    const bounded = clampPosition(positionMs, durationMs);
    this.positionRevision += 1;
    this.seekIntentActive = true;
    const intent = { ...this.snapshot.intent, positionMs: bounded };
    this.patchSnapshot({
      intent,
      event: { ...this.snapshot.event, positionMs: bounded, ended: false },
      notice: undefined,
    });

    const session = this.snapshot.session;
    if (!session) {
      this.log.info('seek-intent-before-generation', { positionMs: bounded });
      return true;
    }
    if (!session.options.canSeek) {
      this.patchSnapshot({ notice: 'This stream cannot seek.' });
      return false;
    }

    const localPositionMs = this.activeLocalPosition(session, bounded);
    if (localPositionMs !== undefined) {
      this.log.info('seek-local', {
        sessionId: session.sessionId,
        mode: session.mode,
        absolutePositionMs: bounded,
        localPositionMs,
      });
      this.options.player.seek(localPositionMs);
      return true;
    }

    this.log.info('seek-needs-generation', {
      sessionId: session.sessionId,
      mode: session.mode,
      absolutePositionMs: bounded,
      generationStartMs: session.seekMs,
      localCoverage: this.options.player.localSeekCoverage(),
    });
    this.queueMutation({
      reason: 'seek',
      update: {
        seekMs: bounded,
        preferences: preservedSeekPreferences(session),
      },
    });
    return true;
  }

  seekBy(deltaMs: number): boolean {
    const base = this.seekIntentActive ? this.snapshot.intent.positionMs : this.snapshot.event.positionMs;
    return this.seek(base + deltaMs);
  }

  private activeLocalPosition(session: PlaybackSession, absolutePositionMs: number): number | undefined {
    const localPositionMs = generationLocalPosition(session, absolutePositionMs);
    if (localPositionMs === undefined) return undefined;
    return rangeContainsPosition(this.options.player.localSeekCoverage(), localPositionMs)
      ? localPositionMs
      : undefined;
  }

  private activationPosition(
    session: PlaybackSession,
    desiredAbsoluteMs: number,
    preparedAbsoluteMs: number,
  ): number | undefined {
    const localPositionMs = generationLocalPosition(session, desiredAbsoluteMs);
    if (session.mode === 'direct') return localPositionMs;
    if (Math.round(preparedAbsoluteMs) !== Math.round(desiredAbsoluteMs)) return undefined;
    return localPositionMs ?? 0;
  }

  update(update: PlaybackUpdate): void {
    if (this.disposed) return;
    const session = this.snapshot.session;
    if (!session) {
      this.patchSnapshot({ notice: 'Playback options are still loading.' });
      return;
    }

    const subtitleOnly = isSubtitleOnlyPlaybackUpdate(update);
    const prepared: PlaybackUpdate = subtitleOnly || !session.options.canSeek
      ? update
      : { ...update, seekMs: this.snapshot.intent.positionMs };
    this.queueMutation({
      reason: subtitleOnly ? 'subtitle' : 'representation',
      update: prepared,
    });
  }

  private queueMutation(next: PendingMutation): void {
    const existing = this.pendingMutation;
    this.pendingMutation = existing
      ? {
          reason: next.reason === 'representation' || existing.reason === 'representation'
            ? 'representation'
            : next.reason,
          update: mergePlaybackUpdate(existing.update, next.update),
        }
      : next;
    this.patchSnapshot({ preparingSource: true, notice: next.reason === 'subtitle' ? 'Loading subtitles…' : undefined });
    this.mutationRevision += 1;
    if (!this.mutationLoop) {
      this.mutationLoop = this.drainMutations().finally(() => {
        this.mutationLoop = undefined;
        if (!this.disposed) this.patchSnapshot({ preparingSource: false });
      });
    }
  }

  private async drainMutations(): Promise<void> {
    while (!this.disposed) {
      const pending = this.pendingMutation;
      const current = this.serverSession ?? this.snapshot.session;
      if (!pending || !current) return;
      this.pendingMutation = undefined;
      const requestRevision = this.mutationRevision;
      // A queued generation mutation may have been formed before a newer local
      // transport intent arrived. Generation work is a correctness fallback, so
      // bind it to the latest position at dispatch time rather than preparing a
      // representation around stale transport state.
      const update = pending.reason === 'subtitle' || !current.options.canSeek
        ? pending.update
        : { ...pending.update, seekMs: this.snapshot.intent.positionMs };
      const requestedPositionMs = update.seekMs ?? this.snapshot.intent.positionMs;
      const requestedPositionRevision = this.positionRevision;
      const startedAt = performance.now();

      try {
        const next = await this.options.resolver.update(current.sessionId, update);
        if (this.disposed) return;
        this.serverSession = next;
        this.log.info('generation-update-ready', {
          sessionId: next.sessionId,
          mode: next.mode,
          reason: pending.reason,
          requestedPositionMs,
          serverSeekMs: next.seekMs,
          superseded: requestRevision !== this.mutationRevision,
          elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
        });

        // Newer server-side intent is already queued. Do not churn the media
        // element through an intermediate representation that the user no
        // longer wants; the immutable current source can keep playing meanwhile.
        if (this.pendingMutation) continue;

        const currentDesired = this.snapshot.intent.positionMs;
        const userMovedDuringRequest = requestedPositionRevision !== this.positionRevision;
        if (userMovedDuringRequest && this.activationPosition(next, currentDesired, requestedPositionMs) === undefined) {
          this.pendingMutation = {
            reason: 'seek',
            update: {
              seekMs: currentDesired,
              preferences: preservedSeekPreferences(next),
            },
          };
          this.mutationRevision += 1;
          continue;
        }

        if (pending.reason === 'subtitle' && sourceIdentity(current) === sourceIdentity(next) && this.options.player.setSubtitle) {
          await this.options.player.setSubtitle(next.source.subtitleUrl);
          if (!this.disposed) {
            this.setSession(next);
            this.patchSnapshot({ notice: undefined });
          }
          continue;
        }

        this.activateSession(next, currentDesired, requestedPositionMs);
        if (!this.disposed) this.patchSnapshot({ notice: undefined });
      } catch (error) {
        if (this.disposed) return;
        this.log.error('generation-update-failed', {
          sessionId: current.sessionId,
          reason: pending.reason,
          update,
          error,
        });
        this.patchSnapshot({ notice: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private activateSession(session: PlaybackSession, desiredAbsoluteMs: number, preparedAbsoluteMs: number): void {
    if (this.disposed) return;
    const activationRevision = ++this.sourceActivationRevision;
    const localPositionMs = this.activationPosition(session, desiredAbsoluteMs, preparedAbsoluteMs);

    if (localPositionMs === undefined) {
      // The user moved behind the generation while it was being prepared. This
      // is genuine source-generation work, not a transport wait.
      this.queueMutation({
        reason: 'seek',
        update: {
          seekMs: desiredAbsoluteMs,
          preferences: preservedSeekPreferences(session),
        },
      });
      return;
    }

    this.serverSession = session;
    this.setSession(session);
    this.streamOffsetMs = session.mode === 'direct' ? 0 : Math.max(0, session.seekMs);
    const absoluteStartMs = session.mode === 'direct'
      ? localPositionMs
      : this.streamOffsetMs + localPositionMs;
    // Source attachment emits transient zero/paused media events. Keep the
    // requested transport target authoritative until the active player reports
    // that it has actually reached this source-generation position.
    this.seekIntentActive = true;
    this.patchSnapshot({
      intent: { ...this.snapshot.intent, positionMs: absoluteStartMs },
      event: {
        ...this.snapshot.event,
        positionMs: absoluteStartMs,
        durationMs: session.durationMs,
        paused: this.snapshot.intent.paused,
        ended: false,
        // Buffer residency belongs to a source generation. Never carry the old
        // generation's ranges across a transformed source activation.
        bufferedRangesMs: [],
        forwardBufferMs: 0,
      },
    });

    this.log.info('source-activate', {
      sessionId: session.sessionId,
      mode: session.mode,
      source: session.source.url,
      generationStartMs: this.streamOffsetMs,
      desiredAbsoluteMs,
      localPositionMs,
      paused: this.snapshot.intent.paused,
    });

    const startPaused = this.snapshot.intent.paused;
    void this.options.player.play(session.source, localPositionMs, startPaused).then((started) => {
      if (this.disposed || activationRevision !== this.sourceActivationRevision) return;
      // User intent may have changed while the source was attaching. Reconcile
      // only the delta; source readiness is never a transport-state barrier.
      if (this.snapshot.intent.paused !== startPaused) {
        if (this.snapshot.intent.paused) this.options.player.pause();
        else this.options.player.resume();
      } else if (!startPaused && !started) {
        // Autoplay policy is not a source failure. The observed media event will
        // report paused=true and the always-enabled Play control can retry.
        this.log.info('source-attached-autoplay-not-started', { sessionId: session.sessionId });
      }
    }).catch((error) => {
      if (this.disposed || activationRevision !== this.sourceActivationRevision) return;
      this.fail(error);
    });
  }

  private setSession(session: PlaybackSession): void {
    this.patchSnapshot({ session });
  }

  private onPlayerEvent(next: PlaybackEvent): void {
    if (this.disposed) return;
    const session = this.snapshot.session;
    const absolutePositionMs = next.positionMs + (session?.mode === 'direct' ? 0 : this.streamOffsetMs);
    const absolute: PlaybackEvent = {
      ...next,
      positionMs: absolutePositionMs,
      durationMs: session?.durationMs || next.durationMs,
      bufferedRangesMs: next.bufferedRangesMs?.map((range) => ({
        startMs: range.startMs + (session?.mode === 'direct' ? 0 : this.streamOffsetMs),
        endMs: range.endMs + (session?.mode === 'direct' ? 0 : this.streamOffsetMs),
      })),
    };

    const target = this.snapshot.intent.positionMs;
    if (this.seekIntentActive && !next.seeking && Math.abs(absolutePositionMs - target) <= 1_500) {
      this.seekIntentActive = false;
    }

    // Media events are observations, not commands. In particular, source swaps
    // may transiently emit pause/play events and must never overwrite a Pause or
    // Play intent the user issued while that source was being prepared. Position
    // follows the player only once an outstanding seek/source target is reached.
    const intent = this.seekIntentActive
      ? this.snapshot.intent
      : { ...this.snapshot.intent, positionMs: absolutePositionMs };
    this.patchSnapshot({ event: absolute, intent });
  }

  private fail(error: unknown): void {
    if (this.disposed || this.snapshot.fatalError) return;
    const fatalError = error instanceof Error ? error : new Error(String(error));
    this.log.error('fatal', fatalError);
    this.patchSnapshot({ fatalError, notice: undefined, starting: false, preparingSource: false });
  }

  private patchSnapshot(patch: Partial<PlaybackCoordinatorSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.getSnapshot());
  }
}
