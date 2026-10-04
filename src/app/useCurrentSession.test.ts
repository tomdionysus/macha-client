// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession, UsersApi } from '@machafoundation/core';
import { useCurrentSession } from './useCurrentSession';
import { settle } from '../test/settle';

/** Built outside the render callback: an inline API object changes identity every render and loops the hook's effect. */
function api(currentSession: UsersApi['currentSession']): UsersApi {
  return { currentSession } as unknown as UsersApi;
}

describe('useCurrentSession', () => {
  it('gates on roles the server states in a vocabulary this build knows', async () => {
    const session: CurrentSession = {
      user_id: 'u1',
      username: 'alice',
      roles: ['media_viewer', 'manage_users'],
      expires_unix_ms: Date.now() + 1000,
    };
    const users = api(() => Promise.resolve(session));
    const { result } = renderHook(() => useCurrentSession(users, true));

    await settle();
    expect(result.current.known).toBe(true);
    expect(result.current.session?.roles).toEqual(['media_viewer', 'manage_users']);
  });

  it('takes the stated roles literally, granting nothing the server did not name', async () => {
    // Role names this build does not know grant nothing; reading them as "show everything" would be the dangerous error.
    const stated = {
      id: 'session-id',
      roles: ['anonymous'],
      created_unix_ms: 1789210733341,
      expires_unix_ms: 1791802733341,
    } as unknown as CurrentSession;
    const users = api(() => Promise.resolve(stated));
    const { result } = renderHook(() => useCurrentSession(users, true));

    await settle();
    expect(result.current.known).toBe(true);
    expect(result.current.session?.roles).toEqual(['anonymous']);
  });

  it('is unknown when no node can answer at all', async () => {
    const users = api(() => Promise.reject(new Error('nope')));
    const { result } = renderHook(() => useCurrentSession(users, true));

    await settle();
    expect(result.current.known).toBe(false);
    expect(result.current.session).toBeUndefined();
  });

  it('asks nothing while disabled', () => {
    const currentSession = vi.fn();
    const users = api(currentSession);
    const { result } = renderHook(() => useCurrentSession(users, false));

    expect(currentSession).not.toHaveBeenCalled();
    expect(result.current.known).toBe(false);
  });
});
