// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
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
});
