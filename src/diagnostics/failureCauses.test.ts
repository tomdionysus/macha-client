import { describe, expect, it } from 'vitest';
import { accountSessionLimitNotice, failureCauseMessages } from './failureCauses';

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

describe('a cap refusal is about the account, not the node', () => {
  // The server's session change brings a per-account cap answering
  // `429 account_session_limit`. Nothing here misclassifies it — this client
  // creates no playback session and reads no status off a caught error — but
  // "Playback failed" in front of a node that is working exactly as designed
  // reads as a breakage, and sends a viewer to check a server that is fine.
  //
  // The match is core's (`isAccountSessionLimit` walks the chain, cycle-safe)
  // rather than a code string matched here, because the code is core's to
  // track and four clients matching it separately is how they drift.
  it('names the account when core says the cap refused', () => {
    const refusal = new Error('Macha playback request failed');
    (refusal as { code?: string }).code = 'account_session_limit';
    expect(accountSessionLimitNotice(refusal)).toMatch(/account/i);
  });

  it('finds it beneath a wrapper that states no code of its own', () => {
    const inner = new Error('refused');
    (inner as { code?: string }).code = 'account_session_limit';
    expect(accountSessionLimitNotice(new Error('Macha playback request failed', { cause: inner }))).toMatch(/account/i);
  });

  it('says nothing about an ordinary failure', () => {
    expect(accountSessionLimitNotice(new Error('The node did not serve the first fragment'))).toBeUndefined();
    expect(accountSessionLimitNotice(undefined)).toBeUndefined();
  });
});
