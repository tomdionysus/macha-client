import { useEffect } from 'react';
import { EndpointHealthMonitor, type AuthenticatedFetch, type ClusterStatusApi, type EndpointRegistry } from '@machafoundation/core';
import { clientConfiguration } from '../state/client';

/** Runs core's health loop while mounted and `enabled`. */
export function useEndpointHealthMonitor(
  registry: EndpointRegistry,
  clusterStatusApi: ClusterStatusApi,
  auth: AuthenticatedFetch | undefined,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const monitor = new EndpointHealthMonitor({
      registry,
      clusterStatusApi,
      auth,
      configuration: clientConfiguration,
    });
    monitor.start();
    return () => monitor.stop();
  }, [auth, clusterStatusApi, enabled, registry]);
}
