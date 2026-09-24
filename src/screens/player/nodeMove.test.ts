import { describe, expect, it, vi } from 'vitest';
import { moveStreamToNode, type NodeMoveRuntime } from './nodeMove';

function runtime(moved: boolean): NodeMoveRuntime & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    moveTo: vi.fn(async (endpointId: string, options?: { leadMs?: number }) => {
      calls.push(`moveTo ${endpointId}${options?.leadMs !== undefined ? ` lead ${options.leadMs}` : ''}`);
      return moved;
    }),
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

  it("leads the move by this viewer's measured start cost for that node", async () => {
    // Measured 2026-09-23: gbni-1 took 20.3 s from create to first fragment.
    // Asked for the viewer's own position, the node starts that far behind a
    // join receding at 1x and never catches it.
    const live = runtime(true);
    await moveStreamToNode(live, 'http://10.44.1.50:7438', false, 25_342);
    expect(live.calls).toEqual(['moveTo http://10.44.1.50:7438 lead 25342']);
  });

  it('leaves the lead to core when this viewer has no fresh figure for the node', async () => {
    const live = runtime(true);
    await moveStreamToNode(live, 'http://10.44.1.50:7438', false, undefined);
    expect(live.calls).toEqual(['moveTo http://10.44.1.50:7438']);
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
