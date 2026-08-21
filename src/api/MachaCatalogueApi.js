import { mergeRequestHeaders, queryString } from './httpCompat';
import { parseErrorEnvelope } from './errorEnvelope';
import { isGatewayConnectionFailure, serverUnreachable } from './serverConnection';
export class MachaApiError extends Error {
    status;
    code;
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
function normalizeBaseUrl(value) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '/')
        return '';
    return trimmed.replace(/\/+$/, '');
}
export class MachaCatalogueApi {
    bearerToken;
    baseUrl;
    constructor(baseUrl, bearerToken) {
        this.bearerToken = bearerToken;
        this.baseUrl = normalizeBaseUrl(baseUrl);
    }
    status() {
        return this.getJson('/api/v1/catalogue/status');
    }
    async list(kind, parent) {
        const query = queryString([['type', kind], ['parent', parent]]);
        const suffix = query ? `?${query}` : '';
        const response = await this.getJson(`/api/v1/catalogue/items${suffix}`);
        return response.items;
    }
    get(id) {
        return this.getJson(`/api/v1/catalogue/items/${encodeURIComponent(id)}`);
    }
    update(item, expectedRevision = item.revision) {
        return this.request(`/api/v1/catalogue/items/${encodeURIComponent(item.id)}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'If-Match': `"rev-${expectedRevision}"`,
            },
            body: JSON.stringify(item),
        });
    }
    clearMetadata(id, expectedRevision) {
        return this.request(`/api/v1/catalogue/items/${encodeURIComponent(id)}/metadata`, {
            method: 'DELETE',
            headers: expectedRevision === undefined ? undefined : {
                'If-Match': `"rev-${expectedRevision}"`,
            },
        });
    }
    async search(query, limit = 50) {
        const params = queryString([['q', query], ['limit', String(limit)]]);
        const response = await this.getJson(`/api/v1/catalogue/search?${params}`);
        return response.items;
    }
    async artwork(id) {
        const response = await this.fetch(`/api/v1/catalogue/artwork/${encodeURIComponent(id)}`, 'image/*');
        if (!response.ok)
            await this.throwResponseError(response);
        return response.blob();
    }
    getJson(path) {
        return this.request(path, { method: 'GET' });
    }
    async request(path, init) {
        const response = await this.fetch(path, 'application/json', init);
        if (!response.ok)
            await this.throwResponseError(response);
        if (response.status === 204)
            return undefined;
        return await response.json();
    }
    async fetch(path, accept, init = { method: 'GET' }) {
        const token = this.bearerToken?.trim();
        const headers = mergeRequestHeaders(init.headers, {
            Accept: accept,
            Authorization: token ? `Bearer ${token}` : undefined,
        });
        try {
            return await fetch(`${this.baseUrl}${path}`, { ...init, headers });
        }
        catch {
            throw serverUnreachable();
        }
    }
    async throwResponseError(response) {
        let body;
        let bodyWasJson = false;
        try {
            body = await response.json();
            bodyWasJson = true;
        }
        catch {
            // A proxy-generated 5xx with no Macha JSON envelope usually means its
            // upstream server could not be reached.
        }
        if (isGatewayConnectionFailure(response, bodyWasJson))
            throw serverUnreachable();
        const parsed = parseErrorEnvelope(body, `${response.status} ${response.statusText}`);
        throw new MachaApiError(`Macha catalogue request failed: ${parsed.message}`, response.status, parsed.code);
    }
}
