/**
 * hls.js's own error-type values, restated rather than imported.
 *
 * These are two short strings, and importing the library for them would pull
 * 518 KB into the boot bundle for code that only runs during HLS playback —
 * defeating the on-demand load entirely. `WebHlsPolicy.test.ts` imports the
 * real library and asserts these still match, so a change upstream fails a
 * test rather than silently misclassifying every error.
 */
const HLS_NETWORK_ERROR = 'networkError';
const HLS_MEDIA_ERROR = 'mediaError';
import type { ManagedHlsMediaRecoveryBudget, ManagedHlsMediaRecoveryDecision } from './ManagedHlsRecovery';

export function webHlsBufferConfig(): Record<string, number | boolean> {
  return {
    enableWorker: true,
    maxBufferLength: 60,
    maxMaxBufferLength: 120,
    maxBufferSize: 128 * 1024 * 1024,
    backBufferLength: 30,
  };
}

export type ManagedHlsErrorAction =
  | { action: 'nonfatal' }
  | { action: 'park-paused'; details: string }
  | { action: 'fail-unbuffered'; occurrences: number; details: string }
  | { action: 'restart-network'; attempt: number }
  | { action: 'fail-network'; attempts: number; details: string }
  | { action: 'recover-media'; recovery: ManagedHlsMediaRecoveryDecision }
  | { action: 'fail-media'; recovery: ManagedHlsMediaRecoveryDecision; details: string }
  | { action: 'fail-terminal'; details: string };

/**
 * The status a node answers when a segment exists in the plan but has not been
 * produced yet — "come back", not "I am broken".
 *
 * **500, and deliberately not 503, which reads backwards on purpose.** The
 * obvious assignment is the other way round: 503 is "temporarily unavailable",
 * which is precisely what a hold is. It was specified that way and reversed
 * before deploying, because the two mistakes are not the same size.
 *
 * 503 is what every intermediary — proxy, gateway, load balancer — emits when
 * a service is genuinely down, and none of them will ever emit
 * `segment_not_ready`. A client taught that 503 means "hold, stay on this
 * node" therefore reads a dead node as a healthy one and never fails over:
 * silent, not self-correcting, and worst exactly where a proxy makes it most
 * likely. The inverse mistake — reading an infrastructure 500 as a hold —
 * costs one pointless retry and then behaves. Given an asymmetry like that,
 * the recoverable fault is the one to take, so the node speaks the
 * counter-intuitive dialect and the intermediaries keep the intuitive one.
 * (Not hypothetical: haproxy is installed and running on the WAN-facing node,
 * one configuration change from fronting it.)
 *
 * Server contract: `500` carries `segment_not_ready`; a broken generation is
 * `503` (`stream_failed`) and does fail over. Both are 5xx deliberately, so
 * hls.js keeps retrying each — `retryForHttpStatus()` refuses only 4xx and
 * status 0.
 *
 * Discriminated on the HTTP status rather than the JSON error code because the
 * code is not reachable. hls.js's XHR loader reports a bad status as
 * `{ code: xhr.status, text: xhr.statusText }` with `data.response.data`
 * undefined, so the body never reaches the error event; it exists only behind
 * `networkDetails`, which is loader-specific and undocumented. The status is
 * the one field every loader populates the same way.
 */
export const SEGMENT_NOT_READY_STATUS = 500;

type HlsErrorShape = { type?: unknown; response?: { code?: unknown } | null };

/**
 * A held segment: the node is working, and this is the frontier, not a fault.
 *
 * Kept separate from failure classification because it is the *absence* of
 * evidence rather than a kind of it. Failing over here would be actively
 * harmful: a replacement node would start its own generation from nothing,
 * which is strictly slower than waiting for the one already being produced.
 */
export function isHlsSegmentHold(data: HlsErrorShape): boolean {
  return data.type === HLS_NETWORK_ERROR && data.response?.code === SEGMENT_NOT_READY_STATUS;
}

/**
 * Any HLS network error is early node-health evidence, even before it is
 * fatal — except a held segment, which says nothing about the node at all.
 *
 * Note what the default costs if this is wrong in the permissive direction:
 * `@machafoundation/core` treats a `'stream'` failure as endpoint evidence, so an
 * unclassified hold prepares a standby elsewhere and can escalate to failover
 * off a node that was working correctly.
 */
export function isHlsNetworkDegradation(data: HlsErrorShape): boolean {
  return data.type === HLS_NETWORK_ERROR && !isHlsSegmentHold(data);
}

/**
 * @param viewerWaiting Whether the viewer currently wants this playing. Every
 *   judgement below asks "is this node failing the person watching", and while
 *   playback is paused there is nobody to fail: hls.js is topping up a buffer
 *   on its own initiative, against a frontier the viewer will not reach for
 *   minutes or hours. Defaults to true, so a caller that has not thought about
 *   it gets the judging behaviour rather than the silent one.
 */
export function managedHlsErrorAction(
  data: { fatal?: boolean; type?: unknown; details?: unknown },
  recovery: ManagedHlsMediaRecoveryBudget,
  positionMs: number,
  buffered = true,
  viewerWaiting = true,
): ManagedHlsErrorAction {
  if (!data.fatal) {
    // A non-fatal media error while nothing has ever buffered is only
    // non-fatal in hls.js's sense: it will keep retrying, and it recovers some
    // of these without consulting us at all. Nothing buffered after several is
    // a stream this browser cannot take, and continuing costs the node a full
    // segment per attempt. Network errors keep their own path — those recover
    // by moving to another node, and this client can do that.
    if (data.type === HLS_MEDIA_ERROR && !buffered) {
      const decision = recovery.unbufferedMediaError();
      if (decision.action === 'fail') {
        return {
          action: 'fail-unbuffered',
          occurrences: decision.occurrences,
          details: typeof data.details === 'string' ? data.details : 'mediaError',
        };
      }
    }
    return { action: 'nonfatal' };
  }
  // Fatal, and nobody is watching. Judging here spends the one network restart
  // the viewer will need when they come back, and a second fatal error during a
  // long pause tears down a generation nothing was using — which is how a pause
  // ends on a failure screen naming a node the viewer never asked for. Stop
  // asking, and ask again on resume with the viewer actually present.
  //
  // Deliberately every fatal class and not just the network one. A media
  // pipeline that died while paused is in the same position: the recovery is
  // worth attempting when it can be seen to work, and worth nothing beforehand.
  if (!viewerWaiting) {
    return {
      action: 'park-paused',
      details: typeof data.details === 'string' ? data.details : String(data.type ?? 'unknown'),
    };
  }
  if (data.type === HLS_NETWORK_ERROR) {
    const decision = recovery.fatalNetworkError();
    if (decision.action === 'restart') return { action: 'restart-network', attempt: decision.attempt };
    return {
      action: 'fail-network',
      attempts: decision.attempts,
      details: typeof data.details === 'string' ? data.details : 'networkError',
    };
  }
  if (data.type === HLS_MEDIA_ERROR) {
    const decision = recovery.fatalMediaError(positionMs);
    if (decision.action === 'recover') return { action: 'recover-media', recovery: decision };
    return {
      action: 'fail-media',
      recovery: decision,
      details: typeof data.details === 'string' ? data.details : 'mediaError',
    };
  }
  return {
    action: 'fail-terminal',
    details: typeof data.details === 'string' ? data.details : String(data.type ?? 'unknown'),
  };
}
