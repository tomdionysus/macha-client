import { parseErrorEnvelope } from './errorEnvelope';
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
    const query = new URLSearchParams();
    if (kind) query.set('type', kind);
    if (parent !== undefined) query.set('parent', parent);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    const response = await this.getJson<ItemEnvelope>(`/api/v1/catalogue/items${suffix}`);
    return response.items;
  }

  get(id: string): Promise<CatalogueItem> {
    return this.getJson(`/api/v1/catalogue/items/${encodeURIComponent(id)}`);
  }

  async search(query: string, limit = 50): Promise<CatalogueItem[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    const response = await this.getJson<ItemEnvelope>(`/api/v1/catalogue/search?${params.toString()}`);
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

  private fetch(path: string, accept: string, init: RequestInit = { method: 'GET' }): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Accept', accept);
    if (this.bearerToken?.trim()) headers.set('Authorization', `Bearer ${this.bearerToken.trim()}`);
    return fetch(`${this.baseUrl}${path}`, { ...init, headers });
  }

  private async throwResponseError(response: Response): Promise<never> {
    let body: unknown;
    try {
      body = await response.json() as unknown;
    } catch {
      // The server normally returns JSON errors, but preserve the HTTP status if it does not.
    }
    const parsed = parseErrorEnvelope(body, `${response.status} ${response.statusText}`);
    throw new MachaApiError(`Macha catalogue request failed: ${parsed.message}`, response.status, parsed.code);
  }
}
