import { useEffect, useState } from 'react';
import { sessionManager, type AuthenticatedFetch, type SessionManager } from '@machafoundation/core';
import type { EndpointRegistry } from '@machafoundation/core';

export interface Session {
  auth: AuthenticatedFetch;
  /** False only while a cold-start mint attempt is genuinely in flight. */
  ready: boolean;
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
  const [managerReady, setManagerReady] = useState(manager.isReady);

  useEffect(() => manager.subscribe(() => setManagerReady(manager.isReady)), [manager]);

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
    ready: !connectionRequired || !serverConfigured || managerReady,
  };
}
