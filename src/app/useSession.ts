import { useEffect, useMemo, useState } from 'react';
import { fixedBearerToken, sessionManager, type AuthenticatedFetch, type SessionManager } from '../api/SessionManager';
import type { EndpointRegistry } from '../cluster/EndpointRegistry';

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
  manualToken: string;
  endpointRegistry: EndpointRegistry;
}, manager: SessionManager = sessionManager): Session {
  const { connectionRequired, serverConfigured, manualToken, endpointRegistry } = options;
  const [managerReady, setManagerReady] = useState(manager.isReady);

  useEffect(() => manager.subscribe(() => setManagerReady(manager.isReady)), [manager]);

  useEffect(() => {
    if (manualToken || !connectionRequired || !serverConfigured) {
      manager.stop();
      return undefined;
    }
    manager.start(endpointRegistry);
    return () => manager.stop();
  }, [connectionRequired, endpointRegistry, manager, manualToken, serverConfigured]);

  const fixedAuth = useMemo(() => manualToken ? fixedBearerToken(manualToken) : undefined, [manualToken]);

  return {
    auth: fixedAuth ?? manager,
    ready: Boolean(fixedAuth) || !connectionRequired || !serverConfigured || managerReady,
  };
}
