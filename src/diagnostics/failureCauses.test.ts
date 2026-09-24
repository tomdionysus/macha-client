import { describe, expect, it } from 'vitest';
import { accountSessionLimitNotice, playbackFailureHeadline } from './failureCauses';

describe('the sentence a viewer is shown for a terminal failure', () => {
  it('is what the node said, from the layer that knew, not what wrapped it', () => {
    // The shape a failure has after crossing core's envelopes: the outer
    // layers classify, the innermost carries the server's own sentence.
    const refused = new Error('Macha playback request failed');
    (refused as { detail?: string }).detail = 'timed out waiting for the first fragmented-MP4 segment';
    const endpoint = new Error('Macha endpoint http://10.35.1.50:7438 failed: Macha playback request failed', { cause: refused });
    const head = new Error('Web HLS source not found (fragLoadError).', { cause: endpoint });

    expect(playbackFailureHeadline(head)).toBe('timed out waiting for the first fragmented-MP4 segment');
  });

  it('never falls back to the log line', () => {
    // Core's rule: `.message` is two envelopes and a node address in front of
    // somebody trying to watch a film. When no layer stated a sentence, this
    // client says something of its own.
    const error = new Error('Macha endpoint http://10.35.1.50:7438 failed: Failed to fetch');
    const said = playbackFailureHeadline(error);
    expect(said).not.toContain('Macha endpoint');
    expect(said).not.toContain('10.35.1.50');
    expect(said).toMatch(/could not/);
  });

  it('has the same sentence of its own for something that is not an error', () => {
    expect(playbackFailureHeadline(undefined)).toBe(playbackFailureHeadline(new Error('anything')));
    expect(playbackFailureHeadline('a string that got thrown')).toBe(playbackFailureHeadline(undefined));
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
