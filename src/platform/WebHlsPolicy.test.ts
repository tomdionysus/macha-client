import Hls from 'hls.js';

// The policy restates hls.js's error-type strings so the library stays out
// of the boot bundle. If upstream ever changes them, this fails loudly.
import { describe, expect, it } from 'vitest';
import { ManagedHlsMediaRecoveryBudget } from './ManagedHlsRecovery';
import { isHlsNetworkDegradation, managedHlsErrorAction } from './WebHlsPolicy';

describe('managed HLS error policy', () => {
  it('treats even nonfatal network errors as early failover evidence', () => {
    expect(isHlsNetworkDegradation({ type: Hls.ErrorTypes.NETWORK_ERROR })).toBe(true);
    expect(isHlsNetworkDegradation({ type: Hls.ErrorTypes.MEDIA_ERROR })).toBe(false);
    expect(isHlsNetworkDegradation({})).toBe(false);
  });

  it('bounds fatal network restart before exposing source failure for node failover', () => {
    const recovery = new ManagedHlsMediaRecoveryBudget();
    expect(managedHlsErrorAction({ fatal: false }, recovery, 0)).toEqual({ action: 'nonfatal' });
    expect(managedHlsErrorAction({ fatal: true, type: Hls.ErrorTypes.NETWORK_ERROR }, recovery, 0)).toEqual({
      action: 'restart-network',
      attempt: 1,
    });
    expect(managedHlsErrorAction({ fatal: true, type: Hls.ErrorTypes.NETWORK_ERROR, details: 'fragLoadError' }, recovery, 0)).toEqual({
      action: 'fail-network',
      attempts: 1,
      details: 'fragLoadError',
    });
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

  it('keeps the restated hls.js error-type strings in step with the library', () => {
    expect(Hls.ErrorTypes.NETWORK_ERROR).toBe('networkError');
    expect(Hls.ErrorTypes.MEDIA_ERROR).toBe('mediaError');
  });
});
