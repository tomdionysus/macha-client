import Hls from 'hls.js';
import { describe, expect, it } from 'vitest';
import { ManagedHlsMediaRecoveryBudget } from './ManagedHlsRecovery';
import { managedHlsErrorAction } from './WebHlsPolicy';

describe('managed HLS error policy', () => {
  it('distinguishes nonfatal and retryable network errors', () => {
    const recovery = new ManagedHlsMediaRecoveryBudget();
    expect(managedHlsErrorAction({ fatal: false }, recovery, 0)).toEqual({ action: 'nonfatal' });
    expect(managedHlsErrorAction({ fatal: true, type: Hls.ErrorTypes.NETWORK_ERROR }, recovery, 0)).toEqual({ action: 'restart-network' });
  });

  it('turns repeated no-progress media errors into terminal failure', () => {
    const recovery = new ManagedHlsMediaRecoveryBudget();
    expect(managedHlsErrorAction({ fatal: true, type: Hls.ErrorTypes.MEDIA_ERROR }, recovery, 0)).toMatchObject({ action: 'recover-media' });
    expect(managedHlsErrorAction({ fatal: true, type: Hls.ErrorTypes.MEDIA_ERROR, details: 'bufferAppendError' }, recovery, 0)).toMatchObject({
      action: 'fail-media',
      details: 'bufferAppendError',
      recovery: { reason: 'no-progress-after-recovery' },
    });
  });

  it('describes unrecoverable error classes without losing details', () => {
    expect(managedHlsErrorAction({ fatal: true, type: 'muxError', details: 'internalException' }, new ManagedHlsMediaRecoveryBudget(), 0)).toEqual({
      action: 'fail-terminal',
      details: 'internalException',
    });
  });
});
