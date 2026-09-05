// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSessionAuth } from './useSessionAuth';
import { SessionTokenStore } from '../api/SessionTokenStore';
import { bootstrapEndpoints, EndpointRegistry } from '../cluster/EndpointRegistry';
import { SESSION_UNAUTHORIZED_EVENT } from '../api/serverConnection';
import * as SessionAuth from '../api/SessionAuth';

const DAY_MS = 24 * 60 * 60 * 1000;

function renderSessionAuth(overrides: Partial<{
  connectionRequired: boolean;
  serverConfigured: boolean;
  manualToken: string;
}> = {}) {
  const tokenStore = new SessionTokenStore();
  const endpointRegistry = new EndpointRegistry(bootstrapEndpoints(['http://a']));
  const result = renderHook(
    (props: { manualToken: string }) => useSessionAuth(tokenStore, {
      connectionRequired: overrides.connectionRequired ?? true,
      serverConfigured: overrides.serverConfigured ?? true,
      manualToken: props.manualToken,
      endpointRegistry,
    }),
    { initialProps: { manualToken: overrides.manualToken ?? '' } },
  );
  return { tokenStore, endpointRegistry, ...result };
}

describe('useSessionAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('mints an anonymous session at startup and stores the token', async () => {
    vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode').mockResolvedValue({
      token: 'token-a', expiresAtMs: Date.now() + 60 * 60 * 1000,
    });
    const { tokenStore } = renderSessionAuth();

    await vi.waitFor(() => expect(tokenStore.current).toBe('token-a'));
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
    renderSessionAuth();

    await vi.advanceTimersByTimeAsync(0);
    expect(mint).toHaveBeenCalledTimes(1);

    // Advance through several of the internal re-check chunks (each capped
    // well under the 32-bit setTimeout limit) without reaching anywhere
    // near the real 30-day expiry — must not have re-minted even once.
    await vi.advanceTimersByTimeAsync(5 * DAY_MS);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('re-mints once the real remaining time reaches the refresh safety margin', async () => {
    vi.useFakeTimers();
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode')
      .mockResolvedValueOnce({ token: 'token-a', expiresAtMs: Date.now() + 2 * DAY_MS })
      .mockResolvedValue({ token: 'token-b', expiresAtMs: Date.now() + 30 * DAY_MS });
    const { tokenStore } = renderSessionAuth();

    await vi.advanceTimersByTimeAsync(0);
    expect(tokenStore.current).toBe('token-a');

    await vi.advanceTimersByTimeAsync(2 * DAY_MS);
    expect(mint).toHaveBeenCalledTimes(2);
    expect(tokenStore.current).toBe('token-b');
  });

  it('re-mints on a session-unauthorized event from anywhere in the app', async () => {
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode')
      .mockResolvedValueOnce({ token: 'token-a', expiresAtMs: Date.now() + DAY_MS })
      .mockResolvedValueOnce({ token: 'token-b', expiresAtMs: Date.now() + DAY_MS });
    const { tokenStore } = renderSessionAuth();
    await vi.waitFor(() => expect(tokenStore.current).toBe('token-a'));

    window.dispatchEvent(new CustomEvent(SESSION_UNAUTHORIZED_EVENT));

    await vi.waitFor(() => expect(tokenStore.current).toBe('token-b'));
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('never mints when a manual token is configured, and stores it directly', async () => {
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode');
    const { tokenStore } = renderSessionAuth({ manualToken: 'manually-typed-token' });

    await Promise.resolve();
    expect(tokenStore.current).toBe('manually-typed-token');
    expect(mint).not.toHaveBeenCalled();
  });

  it('does not mint when no endpoints are configured yet', async () => {
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode');
    renderSessionAuth({ serverConfigured: false });

    await Promise.resolve();
    expect(mint).not.toHaveBeenCalled();
  });

  it('stops scheduling further mints after unmount', async () => {
    vi.useFakeTimers();
    const mint = vi.spyOn(SessionAuth, 'mintAnonymousSessionAnyNode').mockResolvedValue({
      token: 'token-a', expiresAtMs: Date.now() + DAY_MS,
    });
    const { unmount } = renderSessionAuth();
    await vi.advanceTimersByTimeAsync(0);
    expect(mint).toHaveBeenCalledTimes(1);

    unmount();
    await vi.advanceTimersByTimeAsync(10 * DAY_MS);
    expect(mint).toHaveBeenCalledTimes(1);
  });
});
