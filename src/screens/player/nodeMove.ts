import type { PlaybackRuntime } from '@machafoundation/core';

export type NodeMoveRuntime = Pick<PlaybackRuntime, 'moveTo' | 'retry'>;

/** What became of the viewer's pick. */
export type NodeMoveOutcome = 'moved' | 'refused' | 'retried';

/**
 * Serve this stream from the node the viewer picked, given that the registry
 * already prefers it.
 *
 * **A live generation is moved, never restarted.** Core's `moveTo` builds a
 * session on the chosen node, promotes it under the picture and only then
 * releases the old one. Restarting through `play()` closes first, which was
 * measured as 13.2 s of black between fi-1 and gbni-1.
 *
 * **A refusal leaves the viewer where they were.** `false` from `moveTo` is
 * an ordinary answer, and the outgoing generation was never touched, so
 * falling back to a restart would trade a working picture for a black one.
 * The preference stays set, so the next start or recovery still honours it.
 *
 * **Led by this viewer's measurement when there is one.** The node produces
 * from the position it is asked for, no faster than the viewer watches, so a
 * move asked at the viewer's own position starts one start-cost behind and
 * never catches up. `leadMs` asks for a position that far ahead; without it
 * core uses its own estimate, or none (core `d58375a`).
 *
 * **A failed generation is retried, not moved.** It is already released and
 * there is nothing to move; core spells that as the preference plus `retry()`.
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
