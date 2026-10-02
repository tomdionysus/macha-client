import { useEffect, useState } from 'react';
import type { EndpointCandidate, EndpointRegistry } from '@machafoundation/core';

/**
 * The registry's current candidate order, as React state.
 *
 * Shared by the Status screen and the player, since neither owns the
 * registry. Ordering moves as health and measurements move, so this re-reads on every
 * notification rather than caching a list that would go stale silently.
 */
export function useEndpointCandidates(registry: EndpointRegistry): EndpointCandidate[] {
  const [candidates, setCandidates] = useState<EndpointCandidate[]>(() => registry.candidates());
  useEffect(() => {
    setCandidates(registry.candidates());
    return registry.subscribe(() => setCandidates(registry.candidates()));
  }, [registry]);
  return candidates;
}
