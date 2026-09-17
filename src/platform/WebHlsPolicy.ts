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
import {
  SEGMENT_NOT_READY_STATUS as coreSegmentNotReadyStatus,
  SOURCE_NOT_FOUND_STATUS as coreSourceNotFoundStatus,
} from '@machafoundation/core';

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
  | { action: 'fail-not-found'; details: string }
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
export const SEGMENT_NOT_READY_STATUS = coreSegmentNotReadyStatus;

/**
 * The status a node answers for a source it will not serve: the session it
 * names does not exist, or the fragment is past the end of the plan.
 *
 * **Both, and the client cannot tell which.** Measured against the same node in
 * the same run on 2026-09-17: a segment past the end of a live session's plan
 * answers `404 {"code":"not_found","message":"stream object not found"}`, and a
 * session the node has reaped answers `404 {"code":"not_found","message":"stream
 * not found"}`. Same status, same machine-readable code, one word of English
 * apart — and the body never arrives anyway, because hls.js reports
 * `{ code, text }` and drops it (see the constant above).
 *
 * So this says only what the node said. Deciding *which* 404 it is takes a
 * question this layer has no business asking — `GET` the session and see — and
 * core asks it, on the failure this raises. An adapter that guessed "the
 * session was reaped" would regenerate forever against a player that simply
 * asked for a fragment beyond the end.
 *
 * Core's number, not a copy of it — as is the one above. Both statuses were
 * private to this file until 2026-09-17, for the good reason that core did not
 * export either; `SERVER_SEGMENT_HOLD_MS` is a duration, which is a different
 * thing. Core exports them now and this file takes them from there, because two
 * clients holding private copies of a server constant is how the stall budget
 * went wrong. They stay exported from here so the names read the same at the
 * call sites, and so this file remains the one place the web adapter's HLS
 * status vocabulary is explained.
 */
export const SOURCE_NOT_FOUND_STATUS = coreSourceNotFoundStatus;

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
 * The node declined to serve this source. Not a fault in the node, and never
 * evidence against it.
 *
 * Reached on the *nonfatal* events, which is the point: `response.code` is
 * populated on the very first one, so a source that has gone away is knowable
 * while the buffer built before it still has a minute to run. Measured on
 * 2026-09-17 the first of these arrived 3.7 s before the viewer pressed play.
 */
export function isHlsSourceNotFound(data: HlsErrorShape): boolean {
  return data.type === HLS_NETWORK_ERROR && data.response?.code === SOURCE_NOT_FOUND_STATUS;
}

/**
 * Any HLS network error is early node-health evidence, even before it is
 * fatal — except the two that say nothing about the node at all: a held
 * segment, and a source the node has no record of.
 *
 * Note what the default costs if this is wrong in the permissive direction:
 * `@machafoundation/core` treats a `'stream'` failure as endpoint evidence, so an
 * unclassified hold prepares a standby elsewhere and can escalate to failover
 * off a node that was working correctly.
 *
 * That is not hypothetical for the 404, which was unclassified until
 * 2026-09-17: a session reaped during a pause raised one, this returned true,
 * and the coordinator answered `alternate-preparation-start` — a standby on a
 * different node — 3.7 s before the viewer had even pressed play. The node was
 * healthy throughout and was the only one holding the title's pipeline.
 */
export function isHlsNetworkDegradation(data: HlsErrorShape): boolean {
  return data.type === HLS_NETWORK_ERROR && !isHlsSegmentHold(data) && !isHlsSourceNotFound(data);
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
  // `response` is part of the contract, not an incidental extra: the 404 branch
  // reads it, and an `HlsErrorShape` without one classifies as an ordinary
  // network error. Declared so a caller that drops it fails to compile rather
  // than quietly getting the old behaviour back.
  data: HlsErrorShape & { fatal?: boolean; details?: unknown },
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
  // A node that answered 404 will answer 404 again. The network restart exists
  // for a transport that might recover, and this is not one: the source is
  // gone, and no amount of reloading the same URL brings it back. Spending the
  // budget here cost 33 s and then failed anyway. Reported straight away
  // instead, while the buffer built before the source went away still has time
  // left to run — which is the whole margin a recovery has to be invisible in.
  //
  // Checked before the network branch and after the pause branch, deliberately:
  // this is a network error, but it is the one kind of network error that is
  // not about the network.
  if (isHlsSourceNotFound(data)) {
    return {
      action: 'fail-not-found',
      details: typeof data.details === 'string' ? data.details : 'fragLoadError',
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
