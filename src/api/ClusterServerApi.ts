import type { EndpointRegistry, MachaEndpoint } from '../cluster/EndpointRegistry';
import { MachaServerApi, type ServerApi, type ServerStatus } from './MachaServerApi';
import { ClusterEndpointRouter } from '../cluster/endpointRouting';

/** Read-only playback capability status across all suitable API endpoints. */
export class ClusterServerApi implements ServerApi {
  private readonly apis = new Map<string, MachaServerApi>();
  private readonly router: ClusterEndpointRouter;

  constructor(routerOrRegistry: ClusterEndpointRouter | EndpointRegistry, private readonly bearerToken?: string) {
    this.router = routerOrRegistry instanceof ClusterEndpointRouter
      ? routerOrRegistry
      : new ClusterEndpointRouter(routerOrRegistry);
  }

  async status(): Promise<ServerStatus> {
    return this.router.request(async (endpoint) => {
      const status = await this.api(endpoint).status();
      if (!status.playbackAvailable && [429, 502, 503, 504].includes(status.httpStatus)) {
        throw Object.assign(new Error(`Macha playback API returned ${status.httpStatus}`), { status: status.httpStatus });
      }
      return status;
    });
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
