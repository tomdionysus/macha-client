import { useCallback, useEffect, useState } from 'react';
import { sessionManager, type AuthenticatedFetch, type SessionManager, type SessionMintFailure, type UserRole } from '@machafoundation/core';
import type { EndpointRegistry } from '@machafoundation/core';

export interface Session {
  auth: AuthenticatedFetch;
  /** False only while a cold-start mint is in flight. */
  ready: boolean;
  /**
   * What this session may do, from the token; `undefined` until stated, and for ever on a node too
   * old to state roles. Read it through `sessionPermits` / `sessionLockedOut`, which permit the unknown.
   */
  roles: UserRole[] | undefined;
  /**
   * Why there is no session, or `undefined` when there is one; meaningful only once `ready`. A refusal
   * is not a connection problem. Its `message` is the server's and is never assumed fit to show a viewer.
   */
  mintFailure: SessionMintFailure | undefined;
  /**
   * Ends the session, then starts again as an anonymous viewer, even when the revoke failed. Rejects
   * when the cluster could not be told, since the session is then still valid on the server.
   */
  signOut: () => Promise<void>;
}

/**
 * Configures the app-wide `sessionManager` for the connection settings and subscribes to its state.
 * `ready` only holds the splash: `SessionManager.fetch()` itself waits for the first mint and re-mints on a 401.
 */
export function useSession(options: {
  connectionRequired: boolean;
  serverConfigured: boolean;
  endpointRegistry: EndpointRegistry;
}, manager: SessionManager = sessionManager): Session {
  const { connectionRequired, serverConfigured, endpointRegistry } = options;
  const read = useCallback(() => ({
    ready: manager.isReady,
    roles: manager.roles,
    mintFailure: manager.lastMintFailure,
  }), [manager]);
  const [managerState, setManagerState] = useState(read);

  useEffect(() => manager.subscribe(() => setManagerState(read())), [manager, read]);

  useEffect(() => {
    if (!connectionRequired || !serverConfigured) {
      manager.stop();
      return undefined;
    }
    manager.start(endpointRegistry);
    return () => manager.stop();
  }, [connectionRequired, endpointRegistry, manager, serverConfigured]);

  const signOut = useCallback(async () => {
    try {
      await manager.signOut();
    } finally {
      if (connectionRequired && serverConfigured) manager.start(endpointRegistry);
    }
  }, [connectionRequired, endpointRegistry, manager, serverConfigured]);

  return {
    auth: manager,
    ready: !connectionRequired || !serverConfigured || managerState.ready,
    roles: managerState.roles,
    mintFailure: managerState.mintFailure,
    signOut,
  };
}
