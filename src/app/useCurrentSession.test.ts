// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession, UsersApi } from '@machafoundation/core';
import { useCurrentSession } from './useCurrentSession';

/**
 * One API object per test, built outside the render callback.
 *
 * `renderHook` re-runs its callback on every render, so constructing this
 * inline would hand the hook a new identity each time and re-trigger the
 * effect that caused the render — an unbounded loop that surfaces as the test
 * runner exhausting its heap.
 */
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

    await waitFor(() => expect(result.current.known).toBe(true));
    expect(result.current.session?.roles).toEqual(['media_viewer', 'manage_users']);
  });

  it('takes the stated roles literally, granting nothing the server did not name', async () => {
    // Verbatim from a live 0.37.2 node, whose role names this build does not
    // know. There is no special handling for the account it belongs to: the
    // array simply does not name `importer` or `manager`, so those sections
    // stay hidden for precisely the reason they would for any other user.
    // Reading an unfamiliar name as "cannot interpret, so show everything"
    // would be the dangerous direction to be wrong in.
    const stated = {
      id: 'session-id',
      roles: ['anonymous'],
      created_unix_ms: 1789210733341,
      expires_unix_ms: 1791802733341,
    } as unknown as CurrentSession;
    const users = api(() => Promise.resolve(stated));
    const { result } = renderHook(() => useCurrentSession(users, true));

    await waitFor(() => expect(result.current.known).toBe(true));
    expect(result.current.session?.roles).toEqual(['anonymous']);
  });

  it('is unknown when no node can answer at all', async () => {
    const users = api(() => Promise.reject(new Error('nope')));
    const { result } = renderHook(() => useCurrentSession(users, true));

    await waitFor(() => expect(result.current.known).toBe(false));
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

// Deleted with the code they covered:
//
//   - the whoami retry, because there is nothing left here to retry. Roles no
//     longer come from this request — they ride the token, on
//     `sessionManager.roles`, stated by whichever path produced it. A failure
//     here now costs a display name until the next refresh, not permissions.
//   - `sessionLockedOut`, which is core's. Its semantics are tested there
//     (`sessionRoles.test.ts`) against `roles | undefined`, so that "unknown is
//     not none" holds by construction rather than per call site.
