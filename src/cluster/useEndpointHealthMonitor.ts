import { useEffect } from 'react';
import { EndpointHealthMonitor, type AuthenticatedFetch, type ClusterStatusApi, type EndpointRegistry } from '@macha/core';
import { clientConfiguration } from '../state/client';

/**
 * Binds the core's health loop to a React lifecycle.
 *
 * The loop itself is plain and lives in `@macha/core`; only this binding is
 * framework-specific. `stop()` is idempotent, so a double teardown in strict
 * mode is safe.
 */
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
