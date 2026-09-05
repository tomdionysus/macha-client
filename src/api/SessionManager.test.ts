import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixedBearerToken, NO_AUTH, SessionManager } from './SessionManager';
import { bootstrapEndpoints, EndpointRegistry } from '../cluster/EndpointRegistry';
import * as SessionAuth from './SessionAuth';

const DAY_MS = 24 * 60 * 60 * 1000;

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('fixedBearerToken', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('attaches the given token as a Bearer header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await fixedBearerToken('secret').fetch('http://node.test/x');

    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer secret');
  });

  it('sends no Authorization header when undefined', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await NO_AUTH.fetch('http://node.test/x');

    expect(new Headers(fetchMock.mock.calls[0][1].headers).has('Authorization')).toBe(false);
  });
});

describe('SessionManager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('is not ready until start() is called', () => {
    expect(new SessionManager().isReady).toBe(false);
  });

  it('mints and becomes ready, attaching the token to subsequent requests', async () => {
    vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode').mockResolvedValue({
      token: 'token-a', expiresAtMs: Date.now() + DAY_MS,
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const manager = new SessionManager();

    manager.start(new EndpointRegistry(bootstrapEndpoints(['http://a'])));
    await vi.waitFor(() => expect(manager.isReady).toBe(true));

    await manager.fetch('http://a/x');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer token-a');
  });

  it('becomes ready even when minting fails, so callers do not hang forever', async () => {
    vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode').mockRejectedValue(new Error('unreachable'));
    const manager = new SessionManager();

    manager.start(new EndpointRegistry(bootstrapEndpoints(['http://a'])));
    await vi.waitFor(() => expect(manager.isReady).toBe(true));
  });

  it('notifies subscribers when readiness changes', async () => {
    vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode').mockResolvedValue({
      token: 'token-a', expiresAtMs: Date.now() + DAY_MS,
    });
    const manager = new SessionManager();
    const listener = vi.fn();
    manager.subscribe(listener);

    manager.start(new EndpointRegistry(bootstrapEndpoints(['http://a'])));
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
  });

  it('re-mints on a 401 from a request made through fetch()', async () => {
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode')
      .mockResolvedValueOnce({ token: 'token-a', expiresAtMs: Date.now() + DAY_MS })
      .mockResolvedValueOnce({ token: 'token-b', expiresAtMs: Date.now() + DAY_MS });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const manager = new SessionManager();
    manager.start(new EndpointRegistry(bootstrapEndpoints(['http://a'])));
    await vi.waitFor(() => expect(manager.isReady).toBe(true));

    await manager.fetch('http://a/x');

    await vi.waitFor(() => expect(mint).toHaveBeenCalledTimes(2));
  });

  it('does not re-mint on a slow request whose 401 arrives after a token was already adopted', async () => {
    // A caller that raced ahead of the very first mint (no token exists yet
    // at the moment it fires) gets a 401 for the obvious reason — that is not
    // evidence the *current*, since-adopted session is bad. Reacting to it
    // once it finally resolves would clobber a perfectly good session with a
    // wasteful, redundant mint.
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode').mockResolvedValue({
      token: 'token-a', expiresAtMs: Date.now() + DAY_MS,
    });
    let resolveSlowFetch: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveSlowFetch = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const manager = new SessionManager();
    manager.start(new EndpointRegistry(bootstrapEndpoints(['http://a'])));

    // Fired while manager.token is still undefined (mint hasn't resolved yet).
    const slowFetch = manager.fetch('http://a/x');
    await vi.waitFor(() => expect(manager.isReady).toBe(true));
    expect(mint).toHaveBeenCalledTimes(1);

    // Only now does the slow, tokenless request's 401 actually arrive.
    resolveSlowFetch!(new Response(null, { status: 401 }));
    await slowFetch;

    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('never lets a long-lived expiry overflow setTimeout into an immediate re-mint loop', async () => {
    // Regression test: setTimeout's delay is a 32-bit signed int (~24.8 day
    // max) — scheduling a refresh for the full remaining time on a
    // multi-week session (this contract's own example is 30 days) silently
    // overflows to ~0ms and re-mints in a tight infinite loop.
    vi.useFakeTimers();
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode').mockResolvedValue({
      token: 'token-a', expiresAtMs: Date.now() + 30 * DAY_MS,
    });
    const manager = new SessionManager();

    manager.start(new EndpointRegistry(bootstrapEndpoints(['http://a'])));
    await vi.advanceTimersByTimeAsync(0);
    expect(mint).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5 * DAY_MS);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('re-mints once the real remaining time reaches the refresh safety margin', async () => {
    vi.useFakeTimers();
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode')
      .mockResolvedValueOnce({ token: 'token-a', expiresAtMs: Date.now() + 2 * DAY_MS })
      .mockResolvedValue({ token: 'token-b', expiresAtMs: Date.now() + 30 * DAY_MS });
    const manager = new SessionManager();

    manager.start(new EndpointRegistry(bootstrapEndpoints(['http://a'])));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(2 * DAY_MS);
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('stops scheduling further mints after stop()', async () => {
    vi.useFakeTimers();
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode').mockResolvedValue({
      token: 'token-a', expiresAtMs: Date.now() + DAY_MS,
    });
    const manager = new SessionManager();
    manager.start(new EndpointRegistry(bootstrapEndpoints(['http://a'])));
    await vi.advanceTimersByTimeAsync(0);
    expect(mint).toHaveBeenCalledTimes(1);

    manager.stop();
    await vi.advanceTimersByTimeAsync(10 * DAY_MS);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('restarting against a new registry resets readiness until the new mint settles', async () => {
    vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode').mockResolvedValue({
      token: 'token-a', expiresAtMs: Date.now() + DAY_MS,
    });
    const manager = new SessionManager();
    manager.start(new EndpointRegistry(bootstrapEndpoints(['http://a'])));
    await vi.waitFor(() => expect(manager.isReady).toBe(true));

    manager.start(new EndpointRegistry(bootstrapEndpoints(['http://b'])));
    expect(manager.isReady).toBe(false);
    await vi.waitFor(() => expect(manager.isReady).toBe(true));
  });
});

describe('SessionManager cached-session validation (Law 2: never make the viewer wait)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('adopts a validated cached session without minting a new one', async () => {
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode');
    const validate = vi.spyOn(SessionAuth, 'validateAnonymousSessionAnyNode').mockResolvedValue(true);
    const storage = new MemoryStorage();
    storage.setItem('macha-session', JSON.stringify({ token: 'cached-token', expiresAtMs: Date.now() + DAY_MS }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const manager = new SessionManager(storage);

    manager.start(new EndpointRegistry(bootstrapEndpoints(['http://a'])));
    await vi.waitFor(() => expect(manager.isReady).toBe(true));

    expect(validate).toHaveBeenCalledWith(expect.anything(), 'cached-token');
    expect(mint).not.toHaveBeenCalled();
    await manager.fetch('http://a/x');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer cached-token');
  });

  it('mints fresh when the cached session fails validation, and re-caches the result', async () => {
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode').mockResolvedValue({
      token: 'fresh-token', expiresAtMs: Date.now() + DAY_MS,
    });
    vi.spyOn(SessionAuth, 'validateAnonymousSessionAnyNode').mockResolvedValue(false);
    const storage = new MemoryStorage();
    storage.setItem('macha-session', JSON.stringify({ token: 'stale-token', expiresAtMs: Date.now() + DAY_MS }));
    const manager = new SessionManager(storage);

    manager.start(new EndpointRegistry(bootstrapEndpoints(['http://a'])));
    await vi.waitFor(() => expect(manager.isReady).toBe(true));

    expect(mint).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.getItem('macha-session') ?? '')).toEqual({
      token: 'fresh-token', expiresAtMs: expect.any(Number),
    });
  });

  it('mints fresh without validating when the cached session is already expired', async () => {
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode').mockResolvedValue({
      token: 'fresh-token', expiresAtMs: Date.now() + DAY_MS,
    });
    const validate = vi.spyOn(SessionAuth, 'validateAnonymousSessionAnyNode');
    const storage = new MemoryStorage();
    storage.setItem('macha-session', JSON.stringify({ token: 'old-token', expiresAtMs: Date.now() - 1_000 }));
    const manager = new SessionManager(storage);

    manager.start(new EndpointRegistry(bootstrapEndpoints(['http://a'])));
    await vi.waitFor(() => expect(manager.isReady).toBe(true));

    expect(validate).not.toHaveBeenCalled();
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('mints fresh when there is nothing cached, and caches the result for next time', async () => {
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode').mockResolvedValue({
      token: 'fresh-token', expiresAtMs: Date.now() + DAY_MS,
    });
    const storage = new MemoryStorage();
    const manager = new SessionManager(storage);

    manager.start(new EndpointRegistry(bootstrapEndpoints(['http://a'])));
    await vi.waitFor(() => expect(manager.isReady).toBe(true));

    expect(mint).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.getItem('macha-session') ?? '').token).toBe('fresh-token');
  });
});
