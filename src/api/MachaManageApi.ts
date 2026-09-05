import { authenticatedRequestHeaders, normalizeBaseUrl, queryString, readResponseBody, type BearerTokenSource } from './httpCompat';
import { parseErrorEnvelope } from './errorEnvelope';
import { isGatewayConnectionFailure, reportUnauthorized, serverUnreachable } from './serverConnection';
import type {
  IdentityAssociationResetRequest,
  IdentityAssociationResetResult,
  MachaDfsDirectory,
  ManageApi,
  ManualMetadata,
  ManualMetadataResult,
  MatchSearchResult,
  UnmatchedDetail,
  UnmatchedFile,
} from './ManageApi';

export class MachaManageApiError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: string) {
    super(message);
    this.name = 'MachaManageApiError';
  }
}

export class MachaManageApi implements ManageApi {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly bearerToken?: BearerTokenSource) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  async unmatched(): Promise<UnmatchedFile[]> {
    const response = await this.request<{ items: UnmatchedFile[] }>('/api/v1/manage/unmatched', { method: 'GET', cache: 'no-store' });
    return response.items;
  }

  unmatchedDetail(id: string): Promise<UnmatchedDetail> {
    return this.request(`/api/v1/manage/unmatched/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  prospectiveMatches(id: string, query?: string): Promise<MatchSearchResult> {
    const qs = queryString([['q', query]]);
    return this.request(`/api/v1/manage/unmatched/${encodeURIComponent(id)}/matches${qs ? `?${qs}` : ''}`, { method: 'GET' });
  }

  async retry(id: string): Promise<void> {
    await this.request(`/api/v1/manage/unmatched/${encodeURIComponent(id)}/retry`, { method: 'POST' });
  }

  async match(id: string, catalogueItemId: string): Promise<void> {
    await this.request(`/api/v1/manage/unmatched/${encodeURIComponent(id)}/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogue_item_id: catalogueItemId }),
    });
  }

  manual(id: string, metadata: ManualMetadata): Promise<ManualMetadataResult> {
    return this.request(`/api/v1/manage/unmatched/${encodeURIComponent(id)}/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
  }

  async deleteUnmatched(id: string): Promise<void> {
    await this.request(`/api/v1/manage/unmatched/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  browse(path: string): Promise<MachaDfsDirectory> {
    const qs = queryString([['path', path]]);
    return this.request(`/api/v1/manage/filesystem?${qs}`, { method: 'GET', cache: 'no-store' });
  }

  async mkdir(path: string): Promise<void> {
    await this.request('/api/v1/manage/filesystem/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  }

  async rename(path: string, destination: string): Promise<void> {
    await this.request('/api/v1/manage/filesystem/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, destination, no_replace: true }),
    });
  }

  async deletePath(path: string): Promise<void> {
    const qs = queryString([['path', path]]);
    await this.request(`/api/v1/manage/filesystem?${qs}`, { method: 'DELETE' });
  }

  resetIdentityAssociation(request: IdentityAssociationResetRequest): Promise<IdentityAssociationResetResult> {
    return this.request('/api/v1/manage/identity-associations/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  }

  resetNodeIdentityAssociation(nodeId: string, host: string, port?: number, reason?: string): Promise<IdentityAssociationResetResult> {
    return this.request(`/api/v1/manage/nodes/${encodeURIComponent(nodeId)}/identity-association/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, reason }),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = authenticatedRequestHeaders(init.headers, this.bearerToken);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    } catch {
      throw serverUnreachable();
    }
    if (!response.ok) {
      if (response.status === 401) reportUnauthorized();
      const { body, wasJson } = await readResponseBody(response);
      if (isGatewayConnectionFailure(response, wasJson)) throw serverUnreachable();
      const parsed = parseErrorEnvelope(body, `${response.status} ${response.statusText}`);
      throw new MachaManageApiError(`Macha management request failed: ${parsed.message}`, response.status, parsed.code);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }
}
