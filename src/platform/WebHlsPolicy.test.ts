import Hls from 'hls.js';

// The policy restates hls.js's error-type strings so the library stays out
// of the boot bundle. If upstream ever changes them, this fails loudly.
import { describe, expect, it } from 'vitest';
import { ManagedHlsMediaRecoveryBudget } from './ManagedHlsRecovery';
import { isHlsNetworkDegradation, isHlsSegmentHold, managedHlsErrorAction } from './WebHlsPolicy';

describe('managed HLS error policy', () => {
  it('treats even nonfatal network errors as early failover evidence', () => {
    expect(isHlsNetworkDegradation({ type: Hls.ErrorTypes.NETWORK_ERROR })).toBe(true);
    expect(isHlsNetworkDegradation({ type: Hls.ErrorTypes.MEDIA_ERROR })).toBe(false);
    expect(isHlsNetworkDegradation({})).toBe(false);
  });

  describe('a held segment is not evidence about the node', () => {
    // Server contract: **500** means the fragment exists in the plan and has
    // not been produced yet; a broken generation is 503 and does fail over.
    // That is the reverse of the intuitive reading, deliberately — see the
    // constant's comment. Discriminated on the HTTP status because hls.js
    // never surfaces the JSON error code: its loader reports
    // `{ code: xhr.status, text: xhr.statusText }` with the body dropped.
    const held = { type: Hls.ErrorTypes.NETWORK_ERROR, response: { code: 500 } };
    const broken = { type: Hls.ErrorTypes.NETWORK_ERROR, response: { code: 503 } };

    it('recognises a 500 network error as a hold and nothing else', () => {
      expect(isHlsSegmentHold(held)).toBe(true);
      expect(isHlsSegmentHold(broken)).toBe(false);
      // A media error that happens to carry 500 is not a transport hold.
      expect(isHlsSegmentHold({ type: Hls.ErrorTypes.MEDIA_ERROR, response: { code: 500 } })).toBe(false);
      expect(isHlsSegmentHold({ type: Hls.ErrorTypes.NETWORK_ERROR })).toBe(false);
    });

    it('keeps an intermediary 503 as node evidence, which is the whole reason for the reversal', () => {
      // A proxy or gateway emitting 503 for a genuinely dead node must still
      // fail over. Reading that as a hold would strand the viewer on a node
      // that is gone, silently and without self-correction.
      expect(isHlsSegmentHold(broken)).toBe(false);
      expect(isHlsNetworkDegradation(broken)).toBe(true);
    });

    it('keeps a hold out of node-health evidence while every other network error stays in', () => {
      // The whole point: an unclassified hold prepares a standby elsewhere and
      // can escalate to failover off a node that was working correctly.
      expect(isHlsNetworkDegradation(held)).toBe(false);
      expect(isHlsNetworkDegradation(broken)).toBe(true);
      expect(isHlsNetworkDegradation({ type: Hls.ErrorTypes.NETWORK_ERROR, response: null })).toBe(true);
      expect(isHlsNetworkDegradation({ type: Hls.ErrorTypes.NETWORK_ERROR, response: { code: 404 } })).toBe(true);
      expect(isHlsNetworkDegradation({ type: Hls.ErrorTypes.NETWORK_ERROR, response: { code: 502 } })).toBe(true);
    });
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

  it('fails a stream that keeps raising nonfatal media errors without ever buffering', () => {
    // hls.js recovers from an append against an ended MediaSource on its own,
    // by rebuilding the MediaSource, and calls the error nonfatal. When the
    // browser cannot parse the stream at all, that recovery reaches the same
    // wall forever: a real title refetched the same 2.4 MB segment 58 times in
    // 46 seconds behind an unchanging spinner. Repetition with nothing
    // buffered is the evidence that "nonfatal" is wrong.
    const recovery = new ManagedHlsMediaRecoveryBudget();
    const error = { fatal: false, type: Hls.ErrorTypes.MEDIA_ERROR, details: 'bufferAppendingError' };
    for (let attempt = 1; attempt < 6; attempt += 1) {
      expect(managedHlsErrorAction(error, recovery, 0, false)).toEqual({ action: 'nonfatal' });
    }
    expect(managedHlsErrorAction(error, recovery, 0, false)).toEqual({
      action: 'fail-unbuffered',
      occurrences: 6,
      details: 'bufferAppendingError',
    });
  });

  it('keeps tolerating nonfatal media errors on a stream that is playing', () => {
    const recovery = new ManagedHlsMediaRecoveryBudget();
    const error = { fatal: false, type: Hls.ErrorTypes.MEDIA_ERROR, details: 'bufferStalledError' };
    // Buffered content: the pipeline works, so these are the transient errors
    // hls.js says they are, however many arrive.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(managedHlsErrorAction(error, recovery, 0, true)).toEqual({ action: 'nonfatal' });
    }
    // And a stream that buffers after a bad patch clears the streak, rather
    // than failing later on the strength of errors it recovered from.
    for (let attempt = 0; attempt < 5; attempt += 1) managedHlsErrorAction(error, recovery, 0, false);
    recovery.observeBufferedContent();
    expect(managedHlsErrorAction(error, recovery, 0, false)).toEqual({ action: 'nonfatal' });
  });

  it('leaves nonfatal network errors alone, since another node can answer them', () => {
    const recovery = new ManagedHlsMediaRecoveryBudget();
    const error = { fatal: false, type: Hls.ErrorTypes.NETWORK_ERROR, details: 'fragLoadError' };
    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect(managedHlsErrorAction(error, recovery, 0, false)).toEqual({ action: 'nonfatal' });
    }
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
