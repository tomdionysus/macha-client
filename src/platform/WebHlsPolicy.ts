import Hls from 'hls.js';
import type { ManagedHlsMediaRecoveryBudget, ManagedHlsMediaRecoveryDecision } from './ManagedHlsRecovery';

export function webHlsBufferConfig(positionMs: number): Record<string, number | boolean> {
  return {
    enableWorker: true,
    maxBufferLength: 60,
    maxMaxBufferLength: 120,
    maxBufferSize: 128 * 1024 * 1024,
    backBufferLength: 30,
    startPosition: Math.max(0, positionMs / 1000),
  };
}

export type ManagedHlsErrorAction =
  | { action: 'nonfatal' }
  | { action: 'restart-network' }
  | { action: 'recover-media'; recovery: ManagedHlsMediaRecoveryDecision }
  | { action: 'fail-media'; recovery: ManagedHlsMediaRecoveryDecision; details: string }
  | { action: 'fail-terminal'; details: string };

export function managedHlsErrorAction(
  data: { fatal?: boolean; type?: unknown; details?: unknown },
  recovery: ManagedHlsMediaRecoveryBudget,
  positionMs: number,
): ManagedHlsErrorAction {
  if (!data.fatal) return { action: 'nonfatal' };
  if (data.type === Hls.ErrorTypes.NETWORK_ERROR) return { action: 'restart-network' };
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
