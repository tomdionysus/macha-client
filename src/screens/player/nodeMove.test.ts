import { describe, expect, it, vi } from 'vitest';
import { moveStreamToNode, type NodeMoveRuntime } from './nodeMove';

function runtime(moved: boolean): NodeMoveRuntime & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    moveTo: vi.fn(async (endpointId: string) => { calls.push(`moveTo ${endpointId}`); return moved; }),
    retry: vi.fn(async () => { calls.push('retry'); }),
  };
}

describe('moving a stream to the node a viewer picked', () => {
  it('asks core to move a live generation, and never closes it first', async () => {
    // `play()` closes before it starts: 13.2 s of black, measured between
    // fi-1 and gbni-1. `moveTo` builds there, promotes, then releases here.
    const live = runtime(true);
    await expect(moveStreamToNode(live, 'https://macnessa.macha.network', false)).resolves.toBe('moved');
    expect(live.calls).toEqual(['moveTo https://macnessa.macha.network']);
  });

  it('says the node refused rather than restarting the stream behind the viewer', async () => {
    // `false` is an ordinary answer from core: the node would not build an
    // equivalent generation. What the viewer is watching was never touched,
    // so falling back to `play()` would trade a working picture for black.
    const live = runtime(false);
    await expect(moveStreamToNode(live, 'http://10.35.1.50:7438', false)).resolves.toBe('refused');
    expect(live.calls).toEqual(['moveTo http://10.35.1.50:7438']);
  });

  it('retries a failed generation, because there is nothing left to move', async () => {
    // Core: a failed generation is already released, so a move is a retry on
    // another node, spelled as the preference (already set) and `retry()`.
    const failed = runtime(true);
    await expect(moveStreamToNode(failed, 'http://10.35.1.50:7438', true)).resolves.toBe('retried');
    expect(failed.calls).toEqual(['retry']);
  });
});
