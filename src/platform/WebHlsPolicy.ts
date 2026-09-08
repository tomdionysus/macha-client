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
  | { action: 'fail-unbuffered'; occurrences: number; details: string }
  | { action: 'restart-network'; attempt: number }
  | { action: 'fail-network'; attempts: number; details: string }
  | { action: 'recover-media'; recovery: ManagedHlsMediaRecoveryDecision }
  | { action: 'fail-media'; recovery: ManagedHlsMediaRecoveryDecision; details: string }
  | { action: 'fail-terminal'; details: string };

/** Any HLS network error is early node-health evidence, even before it is fatal. */
export function isHlsNetworkDegradation(data: { type?: unknown }): boolean {
  return data.type === HLS_NETWORK_ERROR;
}

export function managedHlsErrorAction(
  data: { fatal?: boolean; type?: unknown; details?: unknown },
  recovery: ManagedHlsMediaRecoveryBudget,
  positionMs: number,
  buffered = true,
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
