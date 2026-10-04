import { useEffect, useState } from 'react';
import type { EndpointCandidate, EndpointRegistry } from '@machafoundation/core';

/** The registry's current candidate order, re-read on every notification since health and measurements reorder it. */
export function useEndpointCandidates(registry: EndpointRegistry): EndpointCandidate[] {
  const [candidates, setCandidates] = useState<EndpointCandidate[]>(() => registry.candidates());
  useEffect(() => {
    setCandidates(registry.candidates());
    return registry.subscribe(() => setCandidates(registry.candidates()));
  }, [registry]);
  return candidates;
}
