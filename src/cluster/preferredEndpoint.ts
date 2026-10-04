import type { EndpointCandidate } from '@machafoundation/core';

/**
 * The endpoint to prefer for a viewer's chosen node: the first ready one in registry order (core's
 * ranking), since core ranks availability above preference. With none ready, the node's first
 * endpoint, so the choice takes effect when the node recovers.
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
