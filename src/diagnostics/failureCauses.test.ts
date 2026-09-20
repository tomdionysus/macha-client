import { describe, expect, it } from 'vitest';
import { failureCauseMessages } from './failureCauses';

describe('the failures beneath the one being named', () => {
  it('reads out the chain core attached, in the order it happened', () => {
    // The shape core's `terminalRecoveryError` produces: the failure that
    // started the recovery, carrying the attempt that ended it. Measured live
    // as the pair a viewer sees one half of — a node that was serving them,
    // and a candidate an https page could never have fetched.
    const ending = new Error('Macha endpoint http://10.35.1.50:7438 failed: Failed to fetch');
    const originating = new Error('Web HLS source not found (fragLoadError).', { cause: ending });

    expect(failureCauseMessages(originating)).toEqual([
      'Macha endpoint http://10.35.1.50:7438 failed: Failed to fetch',
    ]);
  });

  it('does not say the same thing twice', () => {
    // A layer that wraps a failure without adding to it is common, and the
    // screen repeating one sentence reads as a rendering fault.
    const inner = new Error('Failed to fetch');
    const outer = new Error('Failed to fetch', { cause: inner });
    expect(failureCauseMessages(outer)).toEqual([]);
  });

  it('stops at a cause that is evidence rather than a sentence', () => {
    // `PlaybackSourceError` puts an hls.js payload in `cause`. It belongs in a
    // log, not in front of a viewer, and it is where the readable chain ends.
    const payload = { type: 'networkError', details: 'fragLoadError' };
    const error = new Error('Web HLS network degradation.', { cause: payload });
    expect(failureCauseMessages(error)).toEqual([]);
  });

  it('survives a chain that points back at itself', () => {
    const first = new Error('first');
    const second = new Error('second', { cause: first });
    first.cause = second;
    expect(failureCauseMessages(first)).toEqual(['second']);
  });

  it('has nothing to say about something that is not an error', () => {
    expect(failureCauseMessages(undefined)).toEqual([]);
    expect(failureCauseMessages('a string that got thrown')).toEqual([]);
  });
});
