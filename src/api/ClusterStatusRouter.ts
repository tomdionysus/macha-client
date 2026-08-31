import type { EndpointRegistry, MachaEndpoint } from '../cluster/EndpointRegistry';
import { endpointFailure, retryableEndpointFailure } from '../cluster/endpointFailure';
import {
  MachaClusterStatusApi,
  type ClusterNodeStatus,
  type ClusterStatusApi,
  type ClusterStatusSnapshot,
  type ConnectivityCheck,
} from './ClusterStatusApi';

/** Safe status reads fail over; diagnostic POST actions execute exactly once. */
export class ClusterStatusRouter implements ClusterStatusApi {
  private readonly apis = new Map<string, MachaClusterStatusApi>();

  constructor(private readonly registry: EndpointRegistry, private readonly bearerToken?: string) {}

  status(): Promise<ClusterStatusSnapshot> {
    return this.read((api) => api.status());
  }

  node(id: string): Promise<ClusterNodeStatus> {
    return this.read((api) => api.node(id));
  }

  checkConnectivity(nodeId?: string): Promise<ConnectivityCheck> {
    return this.write((api) => api.checkConnectivity(nodeId));
  }

  private async read<T>(operation: (api: MachaClusterStatusApi) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (const { endpoint } of this.registry.candidates()) {
      try {
        const value = await operation(this.api(endpoint));
        this.registry.recordSuccess(endpoint.id);
        return value;
      } catch (error) {
        if (!retryableEndpointFailure(error)) throw error;
        this.registry.recordFailure(endpoint.id);
        lastError = endpointFailure(endpoint.id, endpoint.baseUrl, error);
      }
    }
    throw lastError ?? new Error('No Macha API endpoint is configured.');
  }

  private async write<T>(operation: (api: MachaClusterStatusApi) => Promise<T>): Promise<T> {
    const endpoint = this.registry.candidates()[0]?.endpoint;
    if (!endpoint) throw new Error('No Macha API endpoint is configured.');
    try {
      const value = await operation(this.api(endpoint));
      this.registry.recordSuccess(endpoint.id);
      return value;
    } catch (error) {
      if (retryableEndpointFailure(error)) this.registry.recordFailure(endpoint.id);
      throw endpointFailure(endpoint.id, endpoint.baseUrl, error);
    }
  }

  private api(endpoint: MachaEndpoint): MachaClusterStatusApi {
    let api = this.apis.get(endpoint.id);
    if (!api) {
      api = new MachaClusterStatusApi(endpoint.baseUrl, this.bearerToken);
      this.apis.set(endpoint.id, api);
    }
    return api;
  }
}
