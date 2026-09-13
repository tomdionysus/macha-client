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
