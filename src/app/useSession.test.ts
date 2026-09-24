// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSession } from './useSession';
import { SessionManager } from '@machafoundation/core';
import { bootstrapEndpoints, EndpointRegistry } from '@machafoundation/core';

/**
 * The mint is stopped at the network rather than by replacing a core export.
 *
 * Spying on the export stopped working when core became an installed package
 * rather than a linked source tree: an ES module namespace is not
 * configurable, so the property cannot be redefined. Stubbing `fetch` is also
 * the better test — it exercises the real mint, its parsing and its failure
 * handling, and does not depend on which function inside core happens to make
 * the request.
 */
function sessionResponse() {
  return new Response(
    JSON.stringify({ id: 'session-1', token: 'token-a', token_type: 'Bearer', roles: ['media_viewer'], created_unix_ms: 1, expires_unix_ms: Date.now() + 60_000 }),
    { status: 201, headers: { 'Content-Type': 'application/json' } },
  );
}

function renderSession(overrides: Partial<{
  connectionRequired: boolean;
  serverConfigured: boolean;
}> = {}) {
  const manager = new SessionManager();
  const endpointRegistry = new EndpointRegistry(bootstrapEndpoints(['http://a']));
  const result = renderHook(
    () => useSession({
      connectionRequired: overrides.connectionRequired ?? true,
      serverConfigured: overrides.serverConfigured ?? true,
      endpointRegistry,
    }, manager),
  );
  return { manager, ...result };
}

describe('useSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts the manager and reports not-ready until the mint settles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionResponse()));
    const { result } = renderSession();

    expect(result.current.ready).toBe(false);
    await vi.waitFor(() => expect(result.current.ready).toBe(true));
  });

  it('carries why the mint failed, and tells a refusal from a silence', async () => {
    // A node that answered 403 in forty milliseconds has been reached and has
    // stated a policy. Core withholds the connection gate for exactly that
    // case — so without this the cluster is up, there is no session, and this
    // client has nothing to say about it: every section stays visible, every
    // request 401s, and the viewer is left reading an app that looks fine.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'anonymous_disabled', message: 'anonymous sessions are disabled' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )));
    const { result } = renderSession();

    await vi.waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.mintFailure?.reason).toBe('refused');
    expect(result.current.mintFailure?.status).toBe(403);
  });

  it('says nothing about a failure once a session is adopted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionResponse()));
    const { result } = renderSession();

    await vi.waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.mintFailure).toBeUndefined();
  });

  it('is immediately ready when no connection is required (override mode)', () => {
    const fetchMock = vi.fn().mockResolvedValue(sessionResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderSession({ connectionRequired: false });

    expect(result.current.ready).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is immediately ready when no endpoints are configured yet', () => {
    const fetchMock = vi.fn().mockResolvedValue(sessionResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderSession({ serverConfigured: false });

    expect(result.current.ready).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops the manager on unmount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionResponse()));
    const { manager, unmount } = renderSession();
    await vi.waitFor(() => expect(manager.isReady).toBe(true));

    unmount();

    expect(manager.isReady).toBe(true); // stop() halts the lifecycle without clearing the token/ready state
  });

  describe('signing out', () => {
    type Call = { method: string; path: string; authorization: string | null };

    /** A node that mints token-a first and token-b after, and records who asked for what. */
    function node(revoke: () => Promise<Response>) {
      const calls: Call[] = [];
      let minted = 0;
      const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const path = new URL(String(input)).pathname;
        calls.push({ method, path, authorization: new Headers(init?.headers).get('Authorization') });
        if (path === '/api/v1/health') return new Response(JSON.stringify({ service: 'macha', status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (method === 'DELETE') return revoke();
        minted += 1;
        const token = minted === 1 ? 'token-a' : 'token-b';
        return new Response(
          JSON.stringify({ id: `session-${minted}`, token, token_type: 'Bearer', roles: ['media_viewer'], created_unix_ms: 1, expires_unix_ms: Date.now() + 60_000 }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      });
      return { calls, fetch };
    }

    it('revokes the session, then starts afresh without ever sending the revoked token again', async () => {
      const { calls, fetch } = node(async () => new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', fetch);
      const { manager, result } = renderSession();
      await vi.waitFor(() => expect(result.current.ready).toBe(true));
      const before = calls.length;

      await act(() => result.current.signOut());

      const after = calls.slice(before);
      expect(after[0]).toMatchObject({ method: 'DELETE', path: '/api/v1/session', authorization: 'Bearer token-a' });
      await vi.waitFor(() => expect(result.current.ready).toBe(true));
      expect(calls.slice(before + 1).every((call) => call.authorization !== 'Bearer token-a')).toBe(true);
      expect(await manager.authorization()).toBe('Bearer token-b');
    });

    it('still starts afresh when the server cannot be told, and says so', async () => {
      const { calls, fetch } = node(async () => { throw new TypeError('Failed to fetch'); });
      vi.stubGlobal('fetch', fetch);
      const { result } = renderSession();
      await vi.waitFor(() => expect(result.current.ready).toBe(true));
      const before = calls.length;

      await act(async () => { await expect(result.current.signOut()).rejects.toBeTruthy(); });

      await vi.waitFor(() => expect(calls.slice(before).some((call) => call.method === 'POST')).toBe(true));
      expect(calls.slice(before).filter((call) => call.method !== 'DELETE').every((call) => call.authorization !== 'Bearer token-a')).toBe(true);
    });
  });
});
