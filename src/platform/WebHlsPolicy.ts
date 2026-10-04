/**
 * hls.js's error-type values, restated so the library stays out of the boot
 * bundle. `WebHlsPolicy.test.ts` asserts they match the real library.
 */
const HLS_NETWORK_ERROR = 'networkError';
const HLS_MEDIA_ERROR = 'mediaError';
import type { ManagedHlsMediaRecoveryBudget, ManagedHlsMediaRecoveryDecision } from './ManagedHlsRecovery';
import {
  SEGMENT_NOT_READY_STATUS as coreSegmentNotReadyStatus,
  SOURCE_NOT_FOUND_STATUS as coreSourceNotFoundStatus,
  SOURCE_SUPERSEDED_STATUS as coreSourceSupersededStatus,
  playbackFailureKindForStatus,
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
 * The status for a segment that is in the plan but not produced yet: wait, do
 * not fail over.
 *
 * It is 500, not 503, because intermediaries emit 503 for a node that is down,
 * and reading that as a hold would prevent failover. A broken generation is
 * `503 stream_failed` and does fail over. Matched on the HTTP status because
 * hls.js's loader drops the response body, so the JSON error code is unreachable.
 */
export const SEGMENT_NOT_READY_STATUS = coreSegmentNotReadyStatus;

/**
 * The status for a source the node will not serve: the session is gone, or the
 * fragment is past the end of the plan. The two are indistinguishable here, so
 * core asks the node which; an adapter that assumed a reaped session would
 * regenerate for ever.
 */
export const SOURCE_NOT_FOUND_STATUS = coreSourceNotFoundStatus;

/** `410 generation_superseded`: the generation has been replaced; the node is healthy. */
export const SOURCE_SUPERSEDED_STATUS = coreSourceSupersededStatus;

/**
 * Whether a status says the object is gone rather than the node is unwell.
 * Core owns the mapping; this only rejects a `response.code` that is not a number.
 */
export function isSourceGoneStatus(status: unknown): boolean {
  return typeof status === 'number' && playbackFailureKindForStatus(status) === 'not-found';
}

type HlsErrorShape = { type?: unknown; response?: { code?: unknown } | null };

/** A held segment: the node is working. Failing over would start a slower generation from nothing elsewhere. */
export function isHlsSegmentHold(data: HlsErrorShape): boolean {
  return data.type === HLS_NETWORK_ERROR && data.response?.code === SEGMENT_NOT_READY_STATUS;
}

/**
 * The node has no record of this source (404) or its generation is superseded
 * (410); never evidence against the node. `response.code` is set on non-fatal
 * events too, so this is knowable while the buffer still has time to run.
 */
export function isHlsSourceNotFound(data: HlsErrorShape): boolean {
  return data.type === HLS_NETWORK_ERROR && isSourceGoneStatus(data.response?.code);
}

/**
 * An HLS network error is node-health evidence even before it is fatal, and
 * core may prepare a standby or fail over on it. A held segment and a gone
 * source are excluded: neither says anything about the node.
 */
export function isHlsNetworkDegradation(data: HlsErrorShape): boolean {
  return data.type === HLS_NETWORK_ERROR && !isHlsSegmentHold(data) && !isHlsSourceNotFound(data);
}

/**
 * @param viewerWaiting Whether the viewer wants this playing. While paused
 *   there is nobody to fail, so fatal errors are parked rather than judged.
 */
export function managedHlsErrorAction(
  // `response` is declared so a caller that drops it fails to compile; without
  // it a 404 classifies as an ordinary network error.
  data: HlsErrorShape & { fatal?: boolean; details?: unknown },
  recovery: ManagedHlsMediaRecoveryBudget,
  positionMs: number,
  buffered = true,
  viewerWaiting = true,
): ManagedHlsErrorAction {
  if (!data.fatal) {
    // Repeated non-fatal media errors with nothing buffered mean a stream this
    // browser cannot take, which hls.js would retry for ever. Network errors
    // recover by moving node instead.
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
  // Fatal while paused, of any class: judging now would spend the recovery
  // budget the viewer needs on resume, so park and ask again then.
  if (!viewerWaiting) {
    return {
      action: 'park-paused',
      details: typeof data.details === 'string' ? data.details : String(data.type ?? 'unknown'),
    };
  }
  // A gone source will not come back, so it is reported at once rather than
  // spending the network restart, while the buffer still has time to run. Must
  // come before the network branch and after the pause branch.
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
