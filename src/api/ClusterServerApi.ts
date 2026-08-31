import type { EndpointRegistry, MachaEndpoint } from '../cluster/EndpointRegistry';
import { endpointFailure, retryableEndpointFailure } from '../cluster/endpointFailure';
import { MachaServerApi, type ServerApi, type ServerStatus } from './MachaServerApi';

/** Read-only playback capability status across all suitable API endpoints. */
export class ClusterServerApi implements ServerApi {
  private readonly apis = new Map<string, MachaServerApi>();

  constructor(private readonly registry: EndpointRegistry, private readonly bearerToken?: string) {}

  async status(): Promise<ServerStatus> {
    let lastError: unknown;
    let lastUnavailable: ServerStatus | undefined;
    for (const { endpoint } of this.registry.candidates()) {
      try {
        const status = await this.api(endpoint).status();
        if (!status.playbackAvailable && [429, 502, 503, 504].includes(status.httpStatus)) {
          this.registry.recordFailure(endpoint.id);
          lastUnavailable = status;
          continue;
        }
        this.registry.recordSuccess(endpoint.id);
        return status;
      } catch (error) {
        if (!retryableEndpointFailure(error)) throw error;
        this.registry.recordFailure(endpoint.id);
        lastError = endpointFailure(endpoint.id, endpoint.baseUrl, error);
      }
    }
    if (lastUnavailable) return lastUnavailable;
    throw lastError ?? new Error('No Macha API endpoint is configured.');
  }

  private api(endpoint: MachaEndpoint): MachaServerApi {
    let api = this.apis.get(endpoint.id);
    if (!api) {
      api = new MachaServerApi(endpoint.baseUrl, this.bearerToken);
      this.apis.set(endpoint.id, api);
    }
    return api;
  }
}
