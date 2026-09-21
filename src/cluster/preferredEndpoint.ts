import type { EndpointCandidate } from '@machafoundation/core';

/**
 * Which of a node's endpoints to state a preference for.
 *
 * **A viewer picks a node; core's preference names an endpoint.** One node is
 * commonly reachable at two addresses, and `prefer()` takes one id, so
 * something has to choose the door. Readiness decides it: core ranks
 * availability above preference, so preferring an endpoint that is cooling
 * down expresses a choice the ordering will then ignore, and the viewer's
 * pick would quietly do nothing until the cooldown expired.
 *
 * Registry order breaks the tie between two ready endpoints, because that
 * order is core's own ranking of them — this has no better opinion about
 * which door onto one machine is faster.
 *
 * Falls back to the node's first endpoint when none is ready, so the choice
 * is still recorded and takes effect the moment that node recovers.
 */
export function preferredEndpointForNode(
  candidates: readonly EndpointCandidate[],
  endpointIds: readonly string[],
): string | undefined {
  if (endpointIds.length === 0) return undefined;
  const ready = candidates.find((candidate) => endpointIds.includes(candidate.endpoint.id) && candidate.ready);
  if (ready) return ready.endpoint.id;
  const known = candidates.find((candidate) => endpointIds.includes(candidate.endpoint.id));
  return known?.endpoint.id ?? endpointIds[0];
}
