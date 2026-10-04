import { describe, expect, it } from 'vitest';
import { accountSessionLimitNotice, playbackFailureHeadline } from './failureCauses';

describe('the sentence a viewer is shown for a terminal failure', () => {
  it('is what the node said, from the layer that knew, not what wrapped it', () => {
    // Outer layers classify; the innermost carries the server's own sentence.
    const refused = new Error('Macha playback request failed');
    (refused as { detail?: string }).detail = 'timed out waiting for the first fragmented-MP4 segment';
    const endpoint = new Error('Macha endpoint http://10.35.1.50:7438 failed: Macha playback request failed', { cause: refused });
    const head = new Error('Web HLS source not found (fragLoadError).', { cause: endpoint });

    expect(playbackFailureHeadline(head)).toBe('timed out waiting for the first fragmented-MP4 segment');
  });

  it('never falls back to the log line', () => {
    // `.message` carries envelopes and a node address, which are not for a viewer.
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
  // A `429 account_session_limit` comes from a working node, so "Playback failed" would mislead.
  // Core's `isAccountSessionLimit` does the matching, so clients cannot drift on the code string.
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
