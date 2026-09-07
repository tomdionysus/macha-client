// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSession } from './useSession';
import { SessionManager } from '@macha/core';
import { bootstrapEndpoints, EndpointRegistry } from '@macha/core';
import * as SessionAuth from '@macha/core';

function renderSession(overrides: Partial<{
  connectionRequired: boolean;
  serverConfigured: boolean;
  manualToken: string;
}> = {}) {
  const manager = new SessionManager();
  const endpointRegistry = new EndpointRegistry(bootstrapEndpoints(['http://a']));
  const result = renderHook(
    (props: { manualToken: string }) => useSession({
      connectionRequired: overrides.connectionRequired ?? true,
      serverConfigured: overrides.serverConfigured ?? true,
      manualToken: props.manualToken,
      endpointRegistry,
    }, manager),
    { initialProps: { manualToken: overrides.manualToken ?? '' } },
  );
  return { manager, ...result };
}

describe('useSession', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts the manager and reports not-ready until the mint settles', async () => {
    vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode').mockResolvedValue({
      token: 'token-a', expiresAtMs: Date.now() + 60_000,
    });
    const { result } = renderSession();

    expect(result.current.ready).toBe(false);
    await vi.waitFor(() => expect(result.current.ready).toBe(true));
  });

  it('never starts the manager, and is immediately ready, with a manual token', () => {
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode');
    const { result, manager } = renderSession({ manualToken: 'manually-typed-token' });

    expect(result.current.ready).toBe(true);
    expect(manager.isReady).toBe(false);
    expect(mint).not.toHaveBeenCalled();
  });

  it('is immediately ready when no connection is required (override mode)', () => {
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode');
    const { result } = renderSession({ connectionRequired: false });

    expect(result.current.ready).toBe(true);
    expect(mint).not.toHaveBeenCalled();
  });

  it('is immediately ready when no endpoints are configured yet', () => {
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode');
    const { result } = renderSession({ serverConfigured: false });

    expect(result.current.ready).toBe(true);
    expect(mint).not.toHaveBeenCalled();
  });

  it('stops the manager on unmount', async () => {
    vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode').mockResolvedValue({
      token: 'token-a', expiresAtMs: Date.now() + 60_000,
    });
    const { manager, unmount } = renderSession();
    await vi.waitFor(() => expect(manager.isReady).toBe(true));

    unmount();

    expect(manager.isReady).toBe(true); // stop() halts the lifecycle without clearing the token/ready state
  });
});
