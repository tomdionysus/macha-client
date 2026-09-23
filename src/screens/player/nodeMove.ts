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
 * **A failed generation is retried, not moved.** It is already released and
 * there is nothing to move; core spells that as the preference plus `retry()`.
 */
export async function moveStreamToNode(
  runtime: NodeMoveRuntime,
  endpointId: string,
  failed: boolean,
): Promise<NodeMoveOutcome> {
  if (failed) {
    await runtime.retry();
    return 'retried';
  }
  return await runtime.moveTo(endpointId) ? 'moved' : 'refused';
}
