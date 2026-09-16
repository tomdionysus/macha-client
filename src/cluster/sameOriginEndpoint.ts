import { useEffect, useMemo, useState } from 'react';
import { createClientLogger, LIVENESS_PATH, normalizeBaseUrl } from '@machafoundation/core';

const log = createClientLogger('cluster.same-origin');

/**
 * How long the splash holds while this page's own origin is asked whether it
 * is a Macha node.
 *
 * Deliberately far shorter than core's `CONNECTION_CHECK_TIMEOUT_MS` (4 s).
 * That budget belongs to a viewer who typed an address and is waiting on their
 * own decision. This one is spent before anybody asked for anything, and what
 * it delays is a screen they could already be using — so it buys much less and
 * must cost much less. A host that is not listening refuses in single-digit
 * milliseconds; only one that accepts the connection and then says nothing
 * costs the whole wait, and that host is not Macha.
 */
export const SAME_ORIGIN_PROBE_TIMEOUT_MS = 1_500;

/**
 * The answers `/api/v1/health` gives: `ok` with 200, and `starting`, `failed`
 * or `busy` with 503. The first three are from server 0.38.5, documented on
 * `LIVENESS_PATH` in core and measured against the deployed cluster on
 * 2026-09-15; `busy` arrives with 0.43.0.
 *
 * `busy` is a node refusing work because its control lane's queue is full, and
 * it carries `Retry-After`. It identifies the node exactly as the others do —
 * the refusal body keeps `service` and `status` for that reason — so it is a
 * node to wait for, never evidence that the address is not Macha. Refusing it
 * would put an endpoint form in front of a viewer during a load spike, on a
 * node that is plainly there.
 */
export type MachaHealthStatus = 'ok' | 'starting' | 'failed' | 'busy';

const HEALTH_STATUSES: readonly MachaHealthStatus[] = ['ok', 'starting', 'failed', 'busy'];

/**
 * The product marker, once a node states one.
 *
 * No released server carries it — the body is `{"status":"ok"}` and nothing
 * else — so it is asserted conditionally: present and wrong is a refusal,
 * absent is tolerated. That is what lets this ship now and tighten later
 * without a flag day across a cluster whose nodes drift apart in practice.
 */
const PRODUCT_MARKER = 'macha';

export interface MachaEndpointConfirmation {
  status: MachaHealthStatus;
  /**
   * Whether the body actually named Macha rather than merely having the shape
   * of one of its answers. Worth recording: it is the difference between proof
   * and strong circumstantial evidence, and it is what says whether the
   * server-side marker has reached this node yet.
   */
  marked: boolean;
}

/**
 * Ask one endpoint whether it is Macha, from a client that has no session.
 *
 * Identity, not readiness. All three health states confirm a node — a node
 * that is starting is still a node, and the health monitor owns whether it can
 * be used yet. Refusing `starting` here would send a viewer who powered on
 * their server and their television together to an endpoint form.
 *
 * The bar is the body, and it has to be. This client's own deployment
 * requirement is that the web host serves `index.html` for unknown application
 * paths, so a host serving this bundle and nothing else answers **200 for the
 * liveness route too**. Confirming on the status line alone would make every
 * correctly-deployed Macha web host identify as a Macha node.
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
    // Refused, timed out, or blocked. None of those identify anything.
    return undefined;
  } finally {
    clearTimeout(timer);
  }

  // 200 serving, 503 starting or failed, and nothing else. A node too old for
  // the route answers 401 rather than 404, because authentication happens
  // before routing — so an old node is simply not adoptable, and falls through
  // to the endpoint screen exactly as an unconfigured client does today.
  if (!response.ok && response.status !== 503) return undefined;

  // The first thing that separates Macha from this client's own web host: that
  // host answers `text/html`.
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (!/^application\/json\b/i.test(contentType.trim())) return undefined;

  let body: unknown;
  try {
    // `response.json()` rather than core's `readJsonBody`, which attributes
    // bytes to the transfer recorder. This endpoint is not in the registry and
    // may turn out not to exist; a probe must not leave throughput evidence
    // against an endpoint ranking has never heard of.
    body = await response.json();
  } catch {
    return undefined;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;

  const record = body as { status?: unknown; service?: unknown };
  if (typeof record.status !== 'string') return undefined;
  const status = record.status as MachaHealthStatus;
  if (!HEALTH_STATUSES.includes(status)) return undefined;
  // The status line and the body carry the same answer: `ok` is the only 200,
  // and every other value is a 503. A payload that disagrees with its own
  // response code is not this contract being answered, whatever it is.
  if (status === 'ok' ? !response.ok : response.status !== 503) return undefined;
  if (record.service !== undefined && record.service !== PRODUCT_MARKER) return undefined;

  // Nothing reads a version here, and nothing should: liveness answers anyone
  // who can reach the port, with no token, and "which release is this" is a
  // reconnaissance question. The server pins that from its side — one test
  // asserts the marker is present, another that the build is not — and the
  // node's version is already on the Status node card, behind `view_status`.
  return { status, marked: record.service === PRODUCT_MARKER };
}

/**
 * The address this page was served from, when that is an address at all.
 *
 * A packaged build has no host to link to: the Samsung widget and the Android
 * shell both load from `file:`, where `origin` names nothing fetchable.
 * Samsung is pinned to its build-time endpoints besides, so it never gets
 * here.
 *
 * Exactly this origin, and no port guessing. "The API is right here" is the
 * whole claim being tested; probing `:7438` on the viewer's own host would be
 * a different address than the one they reached, needing CORS and turning a
 * fast negative into a slow one. An API behind a proxy on another port is an
 * endpoint somebody types.
 */
export function sameOriginCandidate(
  location: { protocol: string; origin: string } = window.location,
): string | undefined {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return undefined;
  return normalizeBaseUrl(location.origin) || undefined;
}

export interface SameOriginEndpoint {
  /** Still being asked. Nothing is decided, and no gate should be shown yet. */
  probing: boolean;
  /** A confirmed Macha node on this page's own origin — for this run only. */
  endpoint?: string;
}

/**
 * Bind the same-origin question to a React lifecycle, for an unconfigured
 * client only.
 *
 * **Nothing here is ever persisted.** A derived endpoint is not user
 * configuration, and writing one where `bootstrapEndpoints` is read from would
 * hand a viewer an endpoint they never typed — one that outlives the page
 * moving to a different host, that they have no reason to go and delete, and
 * that they would have to delete before this could ever look again. It is
 * re-derived and re-confirmed on every cold start instead, which costs one
 * bounded request and can never be stale. This is the same rule core states on
 * `discoveredEndpoints`, for the same reason.
 *
 * It also cannot become authoritative by accident: `enabled` is false the
 * moment anything is configured, and the candidate is dropped with it.
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
          // False means the node did not name itself and was accepted on the
          // shape of its answer alone. Worth seeing in a failure trail.
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
