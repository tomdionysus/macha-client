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
 * Every real request (catalogue loads, health-monitor polling and
 * discovery) must wait for `ready` before firing — every route on this
 * cluster requires `Authorization` unconditionally, so firing before the
 * first token exists is not a race worth accepting: it 401s every time, and
 * previously left the app showing a raw server error with no recovery.
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
