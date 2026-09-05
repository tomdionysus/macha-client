import { useEffect, useRef } from 'react';
import { mintAnonymousSessionAnyNode } from '../api/SessionAuth';
import type { SessionTokenStore } from '../api/SessionTokenStore';
import { reportClusterReachable, reportClusterUnreachable, SESSION_UNAUTHORIZED_EVENT } from '../api/serverConnection';
import type { EndpointRegistry } from '../cluster/EndpointRegistry';

const RETRY_AFTER_MINT_FAILURE_MS = 10_000;
/** No sliding renewal in v1: re-mint shortly before the server-declared expiry rather than waiting to be 401'd. */
const REFRESH_SAFETY_MARGIN_MS = 30_000;
/**
 * `setTimeout`'s delay is a 32-bit signed int internally (~24.8 days max);
 * anything longer silently overflows to fire almost immediately. A session
 * can live far longer than that (this contract's own example is 30 days),
 * so the wait to a distant expiry is chunked into re-checks no longer than
 * this, rather than scheduled as one timer for the full remaining duration.
 */
const MAX_TIMER_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * Owns the lifecycle of the client's anonymous session token in `tokenStore`
 * (a stable object created once by the caller, since it's also handed to
 * `useMachaServices` before this hook's own dependency — the endpoint
 * registry — exists yet): mints one at startup, re-mints shortly before it
 * expires, and re-mints on an unexpected 401 from anywhere in the app (see
 * `reportUnauthorized`). A manually configured bearer token (the Settings
 * screen's optional override) always wins — this never mints over an
 * explicit value the user typed in.
 */
export function useSessionAuth(tokenStore: SessionTokenStore, options: {
  connectionRequired: boolean;
  serverConfigured: boolean;
  manualToken: string;
  endpointRegistry: EndpointRegistry;
}): void {
  const { connectionRequired, serverConfigured, manualToken, endpointRegistry } = options;
  const manualTokenRef = useRef(manualToken);
  manualTokenRef.current = manualToken;

  useEffect(() => {
    if (manualToken) {
      tokenStore.set(manualToken);
      return undefined;
    }
    if (!connectionRequired || !serverConfigured) return undefined;

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<void> | undefined;

    const scheduleRefresh = (expiresAtMs: number) => {
      if (cancelled) return;
      const remainingMs = expiresAtMs - Date.now() - REFRESH_SAFETY_MARGIN_MS;
      if (remainingMs <= 0) {
        void mint();
        return;
      }
      refreshTimer = setTimeout(() => scheduleRefresh(expiresAtMs), Math.min(remainingMs, MAX_TIMER_DELAY_MS));
    };

    const mint = (): Promise<void> => {
      // A manual override configured after this effect started must never
      // be clobbered by a mint that was already in flight.
      if (manualTokenRef.current) return Promise.resolve();
      if (inFlight) return inFlight;
      inFlight = mintAnonymousSessionAnyNode(endpointRegistry)
        .then((session) => {
          if (cancelled || manualTokenRef.current) return;
          tokenStore.set(session.token);
          reportClusterReachable();
          scheduleRefresh(session.expiresAtMs);
        })
        .catch(() => {
          if (cancelled || manualTokenRef.current) return;
          tokenStore.set(undefined);
          reportClusterUnreachable();
          refreshTimer = setTimeout(() => { void mint(); }, RETRY_AFTER_MINT_FAILURE_MS);
        })
        .finally(() => { inFlight = undefined; });
      return inFlight;
    };

    void mint();
    const onUnauthorized = () => { void mint(); };
    window.addEventListener(SESSION_UNAUTHORIZED_EVENT, onUnauthorized);

    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
      window.removeEventListener(SESSION_UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, [connectionRequired, endpointRegistry, manualToken, serverConfigured, tokenStore]);
}
