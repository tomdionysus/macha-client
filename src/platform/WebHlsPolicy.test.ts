import Hls from 'hls.js';

// Imported for real, so a change to the error-type strings the policy restates fails here.
import { describe, expect, it } from 'vitest';
import { ManagedHlsMediaRecoveryBudget } from './ManagedHlsRecovery';
import {
  isHlsNetworkDegradation,
  isHlsSegmentHold,
  isHlsSourceNotFound,
  managedHlsErrorAction,
  SEGMENT_NOT_READY_STATUS,
  SOURCE_NOT_FOUND_STATUS,
  SOURCE_SUPERSEDED_STATUS,
  isSourceGoneStatus,
} from './WebHlsPolicy';

describe('managed HLS error policy', () => {
  it('treats even nonfatal network errors as early failover evidence', () => {
    expect(isHlsNetworkDegradation({ type: Hls.ErrorTypes.NETWORK_ERROR })).toBe(true);
    expect(isHlsNetworkDegradation({ type: Hls.ErrorTypes.MEDIA_ERROR })).toBe(false);
    expect(isHlsNetworkDegradation({})).toBe(false);
  });

  describe('a held segment is not evidence about the node', () => {
    // Server contract: 500 is a planned segment not produced yet; 503 is a broken
    // generation and fails over.
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
      expect(isHlsSegmentHold(broken)).toBe(false);
      expect(isHlsNetworkDegradation(broken)).toBe(true);
    });

    it('keeps a hold out of node-health evidence while every other network error stays in', () => {
      expect(isHlsNetworkDegradation(held)).toBe(false);
      expect(isHlsNetworkDegradation(broken)).toBe(true);
      expect(isHlsNetworkDegradation({ type: Hls.ErrorTypes.NETWORK_ERROR, response: null })).toBe(true);
      expect(isHlsNetworkDegradation({ type: Hls.ErrorTypes.NETWORK_ERROR, response: { code: 502 } })).toBe(true);
    });
  });

  describe('a 404 is what the node says, not what the node is', () => {
    // What a reaped session raises: non-fatal at first, with `response.code` already readable.
    const notFound = { type: Hls.ErrorTypes.NETWORK_ERROR, response: { code: 404 } };

    it('recognises a 404 network error and nothing else', () => {
      expect(isHlsSourceNotFound(notFound)).toBe(true);
      expect(isHlsSourceNotFound({ type: Hls.ErrorTypes.NETWORK_ERROR, response: { code: 500 } })).toBe(false);
      expect(isHlsSourceNotFound({ type: Hls.ErrorTypes.NETWORK_ERROR, response: { code: 503 } })).toBe(false);
      expect(isHlsSourceNotFound({ type: Hls.ErrorTypes.NETWORK_ERROR })).toBe(false);
      // A media error carrying 404 is not the node refusing to serve a source.
      expect(isHlsSourceNotFound({ type: Hls.ErrorTypes.MEDIA_ERROR, response: { code: 404 } })).toBe(false);
    });

    it('keeps a 404 out of node-health evidence, which it never was', () => {
      expect(isHlsNetworkDegradation(notFound)).toBe(false);
      expect(isHlsNetworkDegradation({ type: Hls.ErrorTypes.NETWORK_ERROR, response: { code: 502 } })).toBe(true);
    });

    it('fails a fatal 404 at once and spends no network restart on it', () => {
      const recovery = new ManagedHlsMediaRecoveryBudget();
      expect(managedHlsErrorAction({ fatal: true, ...notFound, details: 'fragLoadError' }, recovery, 0)).toEqual({
        action: 'fail-not-found',
        details: 'fragLoadError',
      });
      // The budget is untouched: a later transport failure still gets its restart.
      expect(managedHlsErrorAction({ fatal: true, type: Hls.ErrorTypes.NETWORK_ERROR }, recovery, 0)).toEqual({
        action: 'restart-network',
        attempt: 1,
      });
    });

    it('still parks a fatal 404 raised while nobody is watching', () => {
      // The pause rule outranks the 404 rule.
      const recovery = new ManagedHlsMediaRecoveryBudget();
      expect(managedHlsErrorAction({ fatal: true, ...notFound, details: 'fragLoadError' }, recovery, 0, true, false))
        .toEqual({ action: 'park-paused', details: 'fragLoadError' });
    });

    it('leaves the 500 hold exactly as it was', () => {
      const held = { type: Hls.ErrorTypes.NETWORK_ERROR, response: { code: 500 } };
      expect(isHlsSegmentHold(held)).toBe(true);
      expect(isHlsSourceNotFound(held)).toBe(false);
      expect(isHlsNetworkDegradation(held)).toBe(false);
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
    // hls.js rebuilds the MediaSource and calls these non-fatal, looping for ever on
    // a stream the browser cannot parse.
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
    // With content buffered these are transient, however many arrive.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(managedHlsErrorAction(error, recovery, 0, true)).toEqual({ action: 'nonfatal' });
    }
    // Buffering after a bad patch clears the streak.
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

  it('does not judge a node while the viewer has playback paused', () => {
    const recovery = new ManagedHlsMediaRecoveryBudget();
    const error = { fatal: true, type: Hls.ErrorTypes.NETWORK_ERROR, details: 'fragLoadError' };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(managedHlsErrorAction(error, recovery, 0, true, false)).toEqual({
        action: 'park-paused',
        details: 'fragLoadError',
      });
    }
    // The budget is untouched, so the viewer still gets a restart on resume.
    expect(managedHlsErrorAction(error, recovery, 0, true, true)).toEqual({
      action: 'restart-network',
      attempt: 1,
    });
  });

  it('parks every fatal class while paused, and still ignores the nonfatal ones', () => {
    const recovery = new ManagedHlsMediaRecoveryBudget();
    expect(managedHlsErrorAction({ fatal: true, type: Hls.ErrorTypes.MEDIA_ERROR }, recovery, 0, true, false))
      .toEqual({ action: 'park-paused', details: 'mediaError' });
    expect(managedHlsErrorAction({ fatal: true, type: 'muxError', details: 'internalException' }, recovery, 0, true, false))
      .toEqual({ action: 'park-paused', details: 'internalException' });
    // A non-fatal error is not parked on: that would stop the buffer filling.
    expect(managedHlsErrorAction({ fatal: false, type: Hls.ErrorTypes.NETWORK_ERROR }, recovery, 0, true, false))
      .toEqual({ action: 'nonfatal' });
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

  it('keeps the status vocabulary in step with core, because absent reads as a match', () => {
    // An `undefined` constant would match every network error that carries no
    // status, so the values are asserted rather than trusted.
    expect(SEGMENT_NOT_READY_STATUS).toBe(500);
    expect(SOURCE_NOT_FOUND_STATUS).toBe(404);
    expect(SOURCE_SUPERSEDED_STATUS).toBe(410);
  });
});

describe('a superseded generation is gone, not a sick node', () => {
  // A 410 on a segment reaches this classifier, not core. Unsorted, it would be
  // reported as `stream` and count against a healthy node.
  const superseded = { type: Hls.ErrorTypes.NETWORK_ERROR, response: { code: 410 } };

  it('reads a 410 fragment as a source the node no longer has', () => {
    expect(isHlsSourceNotFound(superseded)).toBe(true);
  });

  it('keeps a 410 out of node-health evidence', () => {
    expect(isHlsNetworkDegradation(superseded)).toBe(false);
  });

  it('fails a fatal 410 as not-found, so the presentation is not torn down', () => {
    const action = managedHlsErrorAction(
      { ...superseded, fatal: true, details: 'fragLoadError' },
      new ManagedHlsMediaRecoveryBudget(),
      12_000,
    );
    expect(action.action).toBe('fail-not-found');
  });

  it('answers for both gone statuses and nothing else', () => {
    expect(isSourceGoneStatus(404)).toBe(true);
    expect(isSourceGoneStatus(410)).toBe(true);
    expect(isSourceGoneStatus(500)).toBe(false);
    expect(isSourceGoneStatus(503)).toBe(false);
    expect(isSourceGoneStatus(undefined)).toBe(false);
  });
});
