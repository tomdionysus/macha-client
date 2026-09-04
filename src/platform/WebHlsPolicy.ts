import Hls from 'hls.js';
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
  | { action: 'restart-network'; attempt: number }
  | { action: 'fail-network'; attempts: number; details: string }
  | { action: 'recover-media'; recovery: ManagedHlsMediaRecoveryDecision }
  | { action: 'fail-media'; recovery: ManagedHlsMediaRecoveryDecision; details: string }
  | { action: 'fail-terminal'; details: string };

/** Any HLS network error is early node-health evidence, even before it is fatal. */
export function isHlsNetworkDegradation(data: { type?: unknown }): boolean {
  return data.type === Hls.ErrorTypes.NETWORK_ERROR;
}

export function managedHlsErrorAction(
  data: { fatal?: boolean; type?: unknown; details?: unknown },
  recovery: ManagedHlsMediaRecoveryBudget,
  positionMs: number,
): ManagedHlsErrorAction {
  if (!data.fatal) return { action: 'nonfatal' };
  if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
    const decision = recovery.fatalNetworkError();
    if (decision.action === 'restart') return { action: 'restart-network', attempt: decision.attempt };
    return {
      action: 'fail-network',
      attempts: decision.attempts,
      details: typeof data.details === 'string' ? data.details : 'networkError',
    };
  }
  if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
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
