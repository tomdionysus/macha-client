import { mintAnonymousSessionAnyNode, validateAnonymousSessionAnyNode, type AnonymousSession } from './SessionAuth';
import { mergeRequestHeaders } from './httpCompat';
import { reportClusterReachable, reportClusterUnreachable } from './serverConnection';
import type { EndpointRegistry } from '../cluster/EndpointRegistry';

/** sessionStorage (not localStorage): scoped to this tab, and gone with it — matching an anonymous session's own lifetime. */
const SESSION_CACHE_KEY = 'macha-session';
const RETRY_AFTER_MINT_FAILURE_MS = 10_000;
/** No sliding renewal in v1: re-mint shortly before the server-declared expiry rather than waiting to be 401'd. */
const REFRESH_SAFETY_MARGIN_MS = 30_000;
/**
 * `setTimeout`'s delay is a 32-bit signed int internally (~24.8 days max);
 * anything longer silently overflows to fire almost immediately. A session
 * can live far longer than that (this contract's own example is 30 days),
 * so the wait to a distant expiry is chunked into re-checks no longer than
 * this, rather than scheduled as one timer for the full remaining duration.
 */
const MAX_TIMER_DELAY_MS = 24 * 60 * 60 * 1000;

/** Everything an API client needs to make an authenticated request — nothing more. */
export interface AuthenticatedFetch {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

/**
 * A fixed, never-refreshed bearer token: the Settings screen's manual
 * override, and the standard test double wherever a test needs an
 * `AuthenticatedFetch` without exercising session lifecycle at all.
 */
export function fixedBearerToken(token: string | undefined, fetchImpl?: typeof fetch): AuthenticatedFetch {
  const trimmed = token?.trim() || undefined;
  return {
    // `fetchImpl ?? fetch` is resolved on every call, not once at
    // construction — `NO_AUTH` below is a module-level constant built at
    // import time, long before a test's `vi.stubGlobal('fetch', ...)` runs;
    // capturing `fetch` as a bound default parameter here would freeze in
    // whatever `fetch` was at that moment and silently ignore every stub.
    fetch: (url, init = {}) => (fetchImpl ?? fetch)(url, {
      ...init,
      headers: mergeRequestHeaders(init.headers, { Authorization: trimmed ? `Bearer ${trimmed}` : undefined }),
    }),
  };
}

/** Sends no Authorization header at all — the default for a test/caller that doesn't care about auth. */
export const NO_AUTH: AuthenticatedFetch = fixedBearerToken(undefined);

/**
 * Owns the client's anonymous session end to end — minting, proactive
 * refresh before expiry, reactive re-mint on 401, and attaching the current
 * token to every request made through `fetch()`. Every API client depends
 * on this (or `fixedBearerToken`, for a manual override) instead of
 * building its own auth headers and checking for 401 itself: one place
 * owns the contract, not a copy in every client class.
 *
 * One instance (`sessionManager`, below) exists for the life of the app;
 * `src/app/useSession.ts` is a thin React interface onto it, not an owner —
 * tests instantiate their own via `new SessionManager()`.
 */
export class SessionManager implements AuthenticatedFetch {
  private token: string | undefined;
  private ready = false;
  private cancelled = true;
  private settled = false;
  private inFlight: Promise<void> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private registry: EndpointRegistry | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Storage | undefined = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined) {}

  get isReady(): boolean {
    return this.ready;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** (Re)starts the mint/refresh lifecycle against `registry`. Safe to call again if the registry changes. */
  start(registry: EndpointRegistry): void {
    this.stop();
    this.cancelled = false;
    this.settled = false;
    this.ready = false;
    this.registry = registry;
    void this.bootstrap();
  }

  /** Halts the lifecycle (pending timers, in-flight tracking) without clearing the current token. */
  stop(): void {
    this.cancelled = true;
    this.registry = undefined;
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    // Captured before the request, not read again after: a caller that fired
    // before start()/bootstrap() produced any token yet is not evidence the
    // token is bad — there wasn't one to reject. Re-minting on that 401 would
    // be redundant at best (a mint or validation is already in flight) and
    // actively harmful at worst: a slower unrelated request's tokenless 401
    // arriving just after a fast, successful cache validation would blow away
    // a perfectly good just-adopted session for no reason.
    const hadToken = this.token !== undefined;
    const headers = mergeRequestHeaders(init.headers, {
      Authorization: this.token ? `Bearer ${this.token}` : undefined,
    });
    const response = await fetch(url, { ...init, headers });
    if (response.status === 401 && hadToken) void this.mint();
    return response;
  }

  private settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.ready = true;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private loadCachedSession(): AnonymousSession | undefined {
    const raw = this.storage?.getItem(SESSION_CACHE_KEY);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as Partial<AnonymousSession>;
      if (typeof parsed.token !== 'string' || typeof parsed.expiresAtMs !== 'number') return undefined;
      return { token: parsed.token, expiresAtMs: parsed.expiresAtMs };
    } catch {
      return undefined;
    }
  }

  private cacheSession(session: AnonymousSession): void {
    try {
      this.storage?.setItem(SESSION_CACHE_KEY, JSON.stringify(session));
    } catch {
      // Best-effort: a full/unavailable sessionStorage (private browsing,
      // quota) just means the next reload mints fresh instead of validating.
    }
  }

  private adopt(session: AnonymousSession): void {
    this.settle();
    if (this.cancelled) return;
    this.token = session.token;
    this.notify();
    reportClusterReachable();
    this.scheduleRefresh(session.expiresAtMs);
  }

  /**
   * `start()`'s entry point. A cached, unexpired token is worth a cheap
   * server-side validity check before falling back to a full mint — Law 2
   * (`docs/principles-and-laws.md`) forbids adding viewer-visible delay, and
   * minting always costs a real round trip plus server-side session creation
   * where validating is a single lightweight authenticated GET that doubles
   * as an endpoint-reachability check. A definitive rejection (401, from any
   * node — anonymous sessions are valid cluster-wide, so this is not
   * node-specific) skips straight to minting; an unreachable-endpoint
   * failure is treated the same, since minting will hit the identical nodes
   * and fail the same way regardless.
   */
  private bootstrap(): Promise<void> {
    if (!this.registry) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const registry = this.registry;
    const cached = this.loadCachedSession();
    this.inFlight = (async () => {
      if (cached && cached.expiresAtMs > Date.now()) {
        let valid = false;
        try {
          valid = await validateAnonymousSessionAnyNode(registry, cached.token);
        } catch {
          valid = false;
        }
        if (this.cancelled) return;
        if (valid) {
          this.adopt(cached);
          return;
        }
      }
      await this.mintNow(registry);
    })().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async mintNow(registry: EndpointRegistry): Promise<void> {
    try {
      const session = await mintAnonymousSessionAnyNode(registry);
      this.cacheSession(session);
      this.adopt(session);
    } catch {
      this.settle();
      if (this.cancelled) return;
      this.token = undefined;
      this.notify();
      reportClusterUnreachable();
      this.refreshTimer = setTimeout(() => { void this.mint(); }, RETRY_AFTER_MINT_FAILURE_MS);
    }
  }

  /** Reactive re-mint (401 from `fetch()`, or the failure-retry timer) — skips validation since the current token is already known bad. */
  private mint(): Promise<void> {
    if (!this.registry) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const registry = this.registry;
    this.inFlight = this.mintNow(registry).finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private scheduleRefresh(expiresAtMs: number): void {
    if (this.cancelled) return;
    const remainingMs = expiresAtMs - Date.now() - REFRESH_SAFETY_MARGIN_MS;
    if (remainingMs <= 0) {
      void this.mint();
      return;
    }
    this.refreshTimer = setTimeout(() => this.scheduleRefresh(expiresAtMs), Math.min(remainingMs, MAX_TIMER_DELAY_MS));
  }
}

/** The one session for the life of the app. `useSession` configures and reads this — it does not own it. */
export const sessionManager = new SessionManager();
