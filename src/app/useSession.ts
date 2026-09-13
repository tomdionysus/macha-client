import { useEffect, useState } from 'react';
import { sessionManager, type AuthenticatedFetch, type SessionManager, type UserRole } from '@machafoundation/core';
import type { EndpointRegistry } from '@machafoundation/core';

export interface Session {
  auth: AuthenticatedFetch;
  /** False only while a cold-start mint attempt is genuinely in flight. */
  ready: boolean;
  /**
   * What this session may do, or `undefined` when nothing has said yet.
   *
   * Comes from the token rather than from a separate request. Both paths that
   * produce a session already state its roles — the mint response carries them,
   * and the warm-reload validation is itself the whoami — so there is no second
   * fetch here to race, fail, or need re-asking after a failover.
   *
   * `undefined` is the third answer and the permissive one: a node too old to
   * state roles leaves it `undefined` for ever, and hiding sections on the
   * strength of an answer nobody gave would empty the navigation for everyone
   * the moment a node was slow. Read it through `sessionPermits` /
   * `sessionLockedOut`, which encode that rule so no call site can forget it.
   */
  roles: UserRole[] | undefined;
}

/**
 * A thin React interface onto the app-wide `sessionManager` singleton — this
 * hook configures it for the current connection settings and subscribes to
 * its state; it does not own or construct a session. Exactly one session
 * exists for the life of the app (or of a test, when `manager` is injected).
 *
 * `ready` is a presentation signal (hold the splash until the cold-start
 * mint settles), not a correctness gate: a request made through `auth`
 * before the first token exists waits for that mint itself, and a 401 on a
 * live token re-mints and retries — `SessionManager.fetch()` owns both, so
 * no caller has to remember to wait.
 */
export function useSession(options: {
  connectionRequired: boolean;
  serverConfigured: boolean;
  endpointRegistry: EndpointRegistry;
}, manager: SessionManager = sessionManager): Session {
  const { connectionRequired, serverConfigured, endpointRegistry } = options;
  const [managerState, setManagerState] = useState(() => ({ ready: manager.isReady, roles: manager.roles }));

  useEffect(
    () => manager.subscribe(() => setManagerState({ ready: manager.isReady, roles: manager.roles })),
    [manager],
  );

  useEffect(() => {
    if (!connectionRequired || !serverConfigured) {
      manager.stop();
      return undefined;
    }
    manager.start(endpointRegistry);
    return () => manager.stop();
  }, [connectionRequired, endpointRegistry, manager, serverConfigured]);

  return {
    auth: manager,
    ready: !connectionRequired || !serverConfigured || managerState.ready,
    roles: managerState.roles,
  };
}
