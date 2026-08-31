import type {
  CatalogueApi,
  CatalogueArtwork,
  CatalogueItem,
  CatalogueKind,
  CatalogueMediaProfile,
  CatalogueStatus,
} from './CatalogueApi';
import { MachaCatalogueApi } from './MachaCatalogueApi';
import type { EndpointRegistry, MachaEndpoint } from '../cluster/EndpointRegistry';
import { endpointFailure, retryableEndpointFailure } from '../cluster/endpointFailure';

type EndpointOperation<T> = (api: MachaCatalogueApi, endpoint: MachaEndpoint) => Promise<T>;

/** Safe catalogue reads fail over; mutations deliberately execute once. */
export class ClusterCatalogueApi implements CatalogueApi {
  private readonly apis = new Map<string, MachaCatalogueApi>();
  private readonly mediaProfiles = new Map<string, CatalogueMediaProfile>();
  private readonly mediaProfileRequests = new Map<string, Promise<CatalogueMediaProfile | undefined>>();

  constructor(
    private readonly registry: EndpointRegistry,
    private readonly bearerToken?: string,
  ) {}

  status(): Promise<CatalogueStatus> {
    return this.read((api) => api.status());
  }

  list(kind?: CatalogueKind, parent?: string): Promise<CatalogueItem[]> {
    return this.read((api) => api.list(kind, parent));
  }

  get(id: string): Promise<CatalogueItem> {
    return this.read((api) => api.get(id));
  }

  mediaProfile(mediaId: string): Promise<CatalogueMediaProfile | undefined> {
    if (!mediaId.startsWith('macha:')) return Promise.resolve(undefined);
    const cached = this.mediaProfiles.get(mediaId);
    if (cached) return Promise.resolve(cached);
    const existing = this.mediaProfileRequests.get(mediaId);
    if (existing) return existing;
    const request = this.readMediaProfile(mediaId).then((profile) => {
      if (profile) this.mediaProfiles.set(mediaId, profile);
      this.mediaProfileRequests.delete(mediaId);
      return profile;
    }, (error) => {
      this.mediaProfileRequests.delete(mediaId);
      throw error;
    });
    this.mediaProfileRequests.set(mediaId, request);
    return request;
  }

  search(query: string, limit?: number): Promise<CatalogueItem[]> {
    return this.read((api) => api.search(query, limit));
  }

  artwork(id: string, signal?: AbortSignal): Promise<Blob> {
    return this.read((api) => api.artwork(id, signal), signal);
  }

  update(item: CatalogueItem, expectedRevision?: number): Promise<CatalogueItem> {
    return this.write((api) => api.update(item, expectedRevision));
  }

  clearMetadata(id: string, expectedRevision?: number): Promise<void> {
    return this.write((api) => api.clearMetadata(id, expectedRevision));
  }

  putArtwork(itemId: string, role: string, mimeType: string, data: Blob): Promise<CatalogueArtwork> {
    return this.write((api) => api.putArtwork(itemId, role, mimeType, data));
  }

  private async read<T>(operation: EndpointOperation<T>, signal?: AbortSignal): Promise<T> {
    let lastError: unknown;
    for (const { endpoint } of this.registry.candidates()) {
      if (signal?.aborted) throw signal.reason;
      try {
        const value = await operation(this.api(endpoint), endpoint);
        this.registry.recordSuccess(endpoint.id);
        return value;
      } catch (error) {
        if (signal?.aborted) throw error;
        if (!retryableEndpointFailure(error)) throw error;
        this.registry.recordFailure(endpoint.id);
        lastError = endpointFailure(endpoint.id, endpoint.baseUrl, error);
      }
    }
    throw lastError ?? new Error('No Macha bootstrap API endpoint is configured.');
  }

  private async readMediaProfile(mediaId: string): Promise<CatalogueMediaProfile | undefined> {
    let lastError: unknown;
    for (const { endpoint } of this.registry.candidates()) {
      try {
        const profile = await this.api(endpoint).mediaProfile(mediaId);
        if (profile) {
          this.registry.recordSuccess(endpoint.id);
          return profile;
        }
        // A temporary negative still proves reachability, but must not become a
        // sticky routing preference or a cached negative.
        this.registry.recordProbeSuccess(endpoint.id);
      } catch (error) {
        if (!retryableEndpointFailure(error)) throw error;
        this.registry.recordFailure(endpoint.id);
        lastError = endpointFailure(endpoint.id, endpoint.baseUrl, error);
      }
    }
    if (lastError) throw lastError;
    return undefined;
  }

  private async write<T>(operation: EndpointOperation<T>): Promise<T> {
    const endpoint = this.registry.candidates()[0]?.endpoint;
    if (!endpoint) throw new Error('No Macha bootstrap API endpoint is configured.');
    try {
      const value = await operation(this.api(endpoint), endpoint);
      this.registry.recordSuccess(endpoint.id);
      return value;
    } catch (error) {
      if (retryableEndpointFailure(error)) this.registry.recordFailure(endpoint.id);
      throw error;
    }
  }

  private api(endpoint: MachaEndpoint): MachaCatalogueApi {
    let api = this.apis.get(endpoint.id);
    if (!api) {
      api = new MachaCatalogueApi(endpoint.baseUrl, this.bearerToken);
      this.apis.set(endpoint.id, api);
    }
    return api;
  }
}
