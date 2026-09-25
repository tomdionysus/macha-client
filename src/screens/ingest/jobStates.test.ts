import { describe, expect, it } from 'vitest';
import { canPause, canResume, isTerminal } from './jobs';
import { stateLabel } from './format';

describe('a torrent waiting for another torrent\'s check (server 0.61.0)', () => {
  it('reads as waiting to verify, not as a code', () => {
    expect(stateLabel('verify_queued')).toBe('Waiting to verify');
    expect(stateLabel('verifying')).toBe('Verifying');
  });

  it('can be paused or cancelled, as it is not finished', () => {
    expect(canPause('torrent', 'verify_queued')).toBe(true);
    expect(canResume('torrent', 'verify_queued')).toBe(false);
    expect(isTerminal('verify_queued')).toBe(false);
  });
});
