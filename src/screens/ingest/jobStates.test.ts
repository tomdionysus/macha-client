import { describe, expect, it } from 'vitest';
import { canPause, canResume, isTerminal } from './jobs';
import { formatBytes, formatCount, formatRate, stateLabel } from './format';

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

describe('a cluster torrent (server 0.64.0)', () => {
  it('waiting to be claimed reads so, and can be paused or cancelled', () => {
    expect(stateLabel('awaiting_node')).toBe('Waiting for a node');
    expect(canPause('torrent', 'awaiting_node')).toBe(true);
    expect(isTerminal('awaiting_node')).toBe(false);
  });

  it('shows figures its node has not reported as unknown, not as nothing', () => {
    expect(formatBytes(null)).toBe('-');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatRate(null)).toBe('-');
    expect(formatCount(null)).toBe('-');
    expect(formatCount(0)).toBe('0');
  });
});
