import type { PlaybackRuntime } from '@machafoundation/core';

export type NodeMoveRuntime = Pick<PlaybackRuntime, 'moveTo' | 'retry'>;

/** What became of the viewer's pick. */
export type NodeMoveOutcome = 'moved' | 'refused' | 'retried';

/**
 * Serves this stream from the node the viewer picked; the registry must already prefer it.
 *
 * - A live generation is moved with `moveTo`, never restarted: `play()` closes first and blacks the screen.
 * - A refusal (`false`) leaves the old generation playing; the preference stays set for the next start.
 * - `leadMs` asks for a position that far ahead, so the new node does not start a start-cost behind.
 * - A failed generation is already released, so it is retried, not moved.
 */
export async function moveStreamToNode(
  runtime: NodeMoveRuntime,
  endpointId: string,
  failed: boolean,
  leadMs?: number,
): Promise<NodeMoveOutcome> {
  if (failed) {
    await runtime.retry();
    return 'retried';
  }
  const moved = leadMs === undefined ? await runtime.moveTo(endpointId) : await runtime.moveTo(endpointId, { leadMs });
  return moved ? 'moved' : 'refused';
}
