import { describe, expect, it } from 'vitest';
import type { ClientLogEntry } from '@macha/core';
import { playbackFailureTrail } from './failureTrail';

function entry(partial: Partial<ClientLogEntry>): ClientLogEntry {
  return {
    sequence: 1,
    timestamp: '2026-09-09T10:00:00.000Z',
    elapsedMs: 0,
    level: 'warn',
    scope: 'playback.cluster',
    event: 'generation-attempt-failed',
    ...partial,
  };
}

describe('the evidence shown behind a playback failure', () => {
  it('keeps only what went wrong, newest last', () => {
    const trail = playbackFailureTrail([
      entry({ level: 'info', event: 'source-activate' }),
      entry({ level: 'debug', event: 'media-element-reused' }),
      entry({ level: 'warn', elapsedMs: 12_340, event: 'source-failover-start' }),
      entry({ level: 'error', elapsedMs: 27_100, event: 'source-failover-exhausted' }),
    ]);

    expect(trail.map((line) => line.event)).toEqual([
      'playback.cluster source-failover-start',
      'playback.cluster source-failover-exhausted',
    ]);
    expect(trail[0].atMs).toBe(12_340);
  });

  it('reads out the message of an error carried as data, which JSON alone renders as {}', () => {
    const [line] = playbackFailureTrail([
      entry({ data: { endpointId: 'gbni-2', error: new Error('connection refused') } }),
    ]);

    expect(line.detail).toContain('connection refused');
    expect(line.detail).toContain('gbni-2');
  });

  it('says nothing rather than something meaningless for an entry carrying no detail', () => {
    expect(playbackFailureTrail([entry({})])[0].detail).toBeUndefined();
    expect(playbackFailureTrail([entry({ data: {} })])[0].detail).toBeUndefined();
  });

  it('bounds a long detail so one line cannot fill the screen', () => {
    const [line] = playbackFailureTrail([entry({ data: { url: 'x'.repeat(500) } })]);
    expect(line.detail).toHaveLength(161);
    expect(line.detail?.endsWith('…')).toBe(true);
  });
});
