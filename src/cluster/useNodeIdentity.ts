import { useEffect } from 'react';
import type { AuthenticatedFetch, ClusterStatusApi, EndpointRegistry } from '@machafoundation/core';
import { nodeIdentityAdvertisements } from './nodeAdvertisements';

/** Slower than the health cycle: node membership changes in deployments, not in seconds. */
const IDENTITY_INTERVAL_MS = 60_000;

/**
 * Teaches the registry which of its endpoints are the same node.
 *
 * Core's health cycle stamps node identity from each node's advertised
 * endpoint only, so a node reachable both as a LAN address and as a public
 * name comes back as one identified endpoint and one *Unidentified node*.
 * Anything grouping by node then shows one machine twice — which is what the
 * player's node control would do.
 *
 * It re-reads because membership can change under a long-lived page, and it
 * fails silently because this is a labelling improvement: without it every
 * endpoint still works, it is just named as itself rather than as its node.
 */
export function useNodeIdentity(
  registry: EndpointRegistry,
  clusterStatusApi: ClusterStatusApi,
  auth: AuthenticatedFetch | undefined,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled || !auth) return undefined;
    let cancelled = false;

    const identify = async () => {
      try {
        const snapshot = await clusterStatusApi.status();
        if (cancelled) return;
        const advertisements = nodeIdentityAdvertisements(snapshot.nodes, registry.candidates());
        if (advertisements.length > 0) registry.applyAdvertisement(advertisements);
      } catch {
        // A cluster that will not say who its nodes are leaves the endpoints
        // named after themselves, which is what they were before this ran.
      }
    };

    void identify();
    const timer = window.setInterval(() => void identify(), IDENTITY_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [auth, clusterStatusApi, enabled, registry]);
}
