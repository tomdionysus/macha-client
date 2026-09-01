import type { EndpointRegistry, MachaEndpoint } from './EndpointRegistry';
import { endpointFailure, retryableEndpointFailure } from './endpointFailure';

export type EndpointOperation<T> = (endpoint: MachaEndpoint) => Promise<T>;

export class MachaClusterRouteError extends Error {
  constructor(public readonly endpointIds: readonly string[], public readonly cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause ?? 'unknown failure');
    super(`All Macha API endpoints failed (${endpointIds.join(', ')}). Last failure: ${detail}`);
    this.name = 'MachaClusterRouteError';
  }
}

/**
 * One routing authority shared by every client API family.
 *
 * Real successful work makes that endpoint authoritative through
 * EndpointRegistry.recordSuccess(). Background probes deliberately use
 * recordProbeSuccess(), so they can update health without stealing authority.
 */
export class ClusterEndpointRouter {
  constructor(readonly registry: EndpointRegistry) {}

  request<T>(operation: EndpointOperation<T>): Promise<T> {
    return this.route(operation);
  }

  mutation<T>(operation: EndpointOperation<T>): Promise<T> {
    const endpoint = this.registry.candidates()[0]?.endpoint;
    if (!endpoint) return Promise.reject(new Error('No Macha API endpoint is configured.'));
    return operation(endpoint).then((result) => {
      this.registry.recordSuccess(endpoint.id);
      return result;
    }, (error) => {
      if (retryableEndpointFailure(error)) this.registry.recordFailure(endpoint.id);
      throw endpointFailure(endpoint.id, endpoint.baseUrl, error);
    });
  }

  async find<T>(operation: EndpointOperation<T | undefined>, signal?: AbortSignal): Promise<T | undefined> {
    let lastError: unknown;
    let observedTemporaryAbsence = false;
    for (const { endpoint } of this.registry.candidates()) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      try {
        const result = await operation(endpoint);
        if (result !== undefined) {
          this.registry.recordSuccess(endpoint.id);
          return result;
        }
        this.registry.recordProbeSuccess(endpoint.id);
        observedTemporaryAbsence = true;
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        if (!retryableEndpointFailure(error)) throw error;
        this.registry.recordFailure(endpoint.id);
        lastError = endpointFailure(endpoint.id, endpoint.baseUrl, error);
      }
    }
    // One reachable node explicitly saying "not available yet" is a valid
    // advisory result. Failures from other candidates must not turn it into an
    // application error or make optional metadata block playback.
    if (lastError && !observedTemporaryAbsence) throw lastError;
    return undefined;
  }

  private async route<T>(operation: EndpointOperation<T>): Promise<T> {
    let lastError: unknown;
    const attempted: string[] = [];
    for (const { endpoint } of this.registry.candidates()) {
      attempted.push(endpoint.id);
      try {
        const result = await operation(endpoint);
        this.registry.recordSuccess(endpoint.id);
        return result;
      } catch (error) {
        if (!retryableEndpointFailure(error)) throw error;
        this.registry.recordFailure(endpoint.id);
        lastError = endpointFailure(endpoint.id, endpoint.baseUrl, error);
      }
    }
    if (lastError) throw new MachaClusterRouteError(attempted, lastError);
    throw new Error('No Macha API endpoint is configured.');
  }
}
