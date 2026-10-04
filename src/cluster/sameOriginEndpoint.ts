import { useEffect, useMemo, useState } from 'react';
import { createClientLogger, LIVENESS_PATH, normalizeBaseUrl } from '@machafoundation/core';

const log = createClientLogger('cluster.same-origin');

/**
 * How long the splash waits on the same-origin probe. Far shorter than core's
 * `CONNECTION_CHECK_TIMEOUT_MS`: nobody asked for this wait, and only a host that
 * accepts the connection and then says nothing costs all of it.
 */
export const SAME_ORIGIN_PROBE_TIMEOUT_MS = 1_500;

/**
 * `/api/v1/health` answers: `ok` with 200; `starting`, `failed` or `busy` with 503.
 * `busy` (queue full, carries `Retry-After`) still identifies a node.
 */
export type MachaHealthStatus = 'ok' | 'starting' | 'failed' | 'busy';

const HEALTH_STATUSES: readonly MachaHealthStatus[] = ['ok', 'starting', 'failed', 'busy'];

/** The product marker. Absent is tolerated; present and wrong is a refusal. */
const PRODUCT_MARKER = 'macha';

export interface MachaEndpointConfirmation {
  status: MachaHealthStatus;
  /** Whether the body named Macha, rather than merely having the shape of its answer. */
  marked: boolean;
}

/**
 * Asks one endpoint, without a session, whether it is Macha. Identity, not
 * readiness: every health state confirms a node. The body decides, because this
 * client's web host serves `index.html` (200) for unknown paths, the liveness route included.
 */
export async function confirmMachaEndpoint(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = SAME_ORIGIN_PROBE_TIMEOUT_MS,
): Promise<MachaEndpointConfirmation | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${LIVENESS_PATH}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch {
    // Refused, timed out or blocked.
    return undefined;
  } finally {
    clearTimeout(timer);
  }

  // 200 or 503 only. A node too old for the route answers 401, since authentication precedes routing.
  if (!response.ok && response.status !== 503) return undefined;

  // This client's own web host answers `text/html`.
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (!/^application\/json\b/i.test(contentType.trim())) return undefined;

  let body: unknown;
  try {
    // Not core's `readJsonBody`: a probe must not record transfer evidence against an unregistered endpoint.
    body = await response.json();
  } catch {
    return undefined;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;

  const record = body as { status?: unknown; service?: unknown };
  if (typeof record.status !== 'string') return undefined;
  const status = record.status as MachaHealthStatus;
  if (!HEALTH_STATUSES.includes(status)) return undefined;
  // `ok` is the only 200; a body that disagrees with its status line is not this contract.
  if (status === 'ok' ? !response.ok : response.status !== 503) return undefined;
  if (record.service !== undefined && record.service !== PRODUCT_MARKER) return undefined;

  // No version is read or wanted: liveness answers anyone, without a token.
  return { status, marked: record.service === PRODUCT_MARKER };
}

/**
 * The page's own origin, when it is fetchable: packaged builds load from `file:`.
 * Exactly this origin, with no port guessing; an API on another port is an endpoint somebody types.
 */
export function sameOriginCandidate(
  location: { protocol: string; origin: string } = window.location,
): string | undefined {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return undefined;
  return normalizeBaseUrl(location.origin) || undefined;
}

export interface SameOriginEndpoint {
  /** Still being asked; show no gate yet. */
  probing: boolean;
  /** A confirmed Macha node on this page's origin, for this run only. */
  endpoint?: string;
}

/**
 * The same-origin probe as a hook, for an unconfigured client only. The result
 * is never persisted: it is re-confirmed on every cold start, so it cannot go
 * stale or outlive the page moving host.
 */
export function useSameOriginEndpoint(enabled: boolean): SameOriginEndpoint {
  const candidate = useMemo(() => enabled ? sameOriginCandidate() : undefined, [enabled]);
  const [state, setState] = useState<SameOriginEndpoint>(() => ({ probing: Boolean(candidate) }));

  useEffect(() => {
    if (!candidate) {
      setState({ probing: false });
      return undefined;
    }
    let cancelled = false;
    setState({ probing: true });
    void confirmMachaEndpoint(candidate).then((confirmation) => {
      if (cancelled) return;
      if (confirmation) {
        log.info('same-origin-adopted', {
          endpoint: candidate,
          status: confirmation.status,
          // False: accepted on the shape of its answer alone.
          marked: confirmation.marked,
        });
      } else {
        log.debug('same-origin-absent', { endpoint: candidate });
      }
      setState({ probing: false, endpoint: confirmation ? candidate : undefined });
    });
    return () => { cancelled = true; };
  }, [candidate]);

  return state;
}
