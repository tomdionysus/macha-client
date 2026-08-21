import { mergeRequestHeaders, queryString } from './httpCompat';
import { parseErrorEnvelope } from './errorEnvelope';
import { isGatewayConnectionFailure, serverUnreachable } from './serverConnection';
import type {
  CatalogueApi,
  CatalogueItem,
  CatalogueKind,
  CatalogueStatus,
} from './CatalogueApi';

interface ItemEnvelope {
  items: CatalogueItem[];
}

export class MachaApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';
  return trimmed.replace(/\/+$/, '');
}

export class MachaCatalogueApi implements CatalogueApi {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly bearerToken?: string,
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  status(): Promise<CatalogueStatus> {
    return this.getJson('/api/v1/catalogue/status');
  }

  async list(kind?: CatalogueKind, parent?: string): Promise<CatalogueItem[]> {
    const query = queryString([['type', kind], ['parent', parent]]);
    const suffix = query ? `?${query}` : '';
    const response = await this.getJson<ItemEnvelope>(`/api/v1/catalogue/items${suffix}`);
    return response.items;
  }

  get(id: string): Promise<CatalogueItem> {
    return this.getJson(`/api/v1/catalogue/items/${encodeURIComponent(id)}`);
  }

  update(item: CatalogueItem, expectedRevision = item.revision): Promise<CatalogueItem> {
    return this.request(`/api/v1/catalogue/items/${encodeURIComponent(item.id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"rev-${expectedRevision}"`,
      },
      body: JSON.stringify(item),
    });
  }

  clearMetadata(id: string, expectedRevision?: number): Promise<void> {
    return this.request(`/api/v1/catalogue/items/${encodeURIComponent(id)}/metadata`, {
      method: 'DELETE',
      headers: expectedRevision === undefined ? undefined : {
        'If-Match': `"rev-${expectedRevision}"`,
      },
    });
  }

  async search(query: string, limit = 50): Promise<CatalogueItem[]> {
    const params = queryString([['q', query], ['limit', String(limit)]]);
    const response = await this.getJson<ItemEnvelope>(`/api/v1/catalogue/search?${params}`);
    return response.items;
  }

  async artwork(id: string): Promise<Blob> {
    const response = await this.fetch(`/api/v1/catalogue/artwork/${encodeURIComponent(id)}`, 'image/*');
    if (!response.ok) await this.throwResponseError(response);
    return response.blob();
  }

  private getJson<T>(path: string): Promise<T> {
    return this.request(path, { method: 'GET' });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetch(path, 'application/json', init);
    if (!response.ok) await this.throwResponseError(response);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  private async fetch(path: string, accept: string, init: RequestInit = { method: 'GET' }): Promise<Response> {
    const token = this.bearerToken?.trim();
    const headers = mergeRequestHeaders(init.headers, {
      Accept: accept,
      Authorization: token ? `Bearer ${token}` : undefined,
    });
    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    } catch {
      throw serverUnreachable();
    }
  }

  private async throwResponseError(response: Response): Promise<never> {
    let body: unknown;
    let bodyWasJson = false;
    try {
      body = await response.json() as unknown;
      bodyWasJson = true;
    } catch {
      // A proxy-generated 5xx with no Macha JSON envelope usually means its
      // upstream server could not be reached.
    }
    if (isGatewayConnectionFailure(response, bodyWasJson)) throw serverUnreachable();
    const parsed = parseErrorEnvelope(body, `${response.status} ${response.statusText}`);
    throw new MachaApiError(`Macha catalogue request failed: ${parsed.message}`, response.status, parsed.code);
  }
}
