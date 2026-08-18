import { parseErrorEnvelope } from './errorEnvelope';
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
        const query = new URLSearchParams();
        if (kind)
            query.set('type', kind);
        if (parent !== undefined)
            query.set('parent', parent);
        const suffix = query.size > 0 ? `?${query.toString()}` : '';
        const response = await this.getJson(`/api/v1/catalogue/items${suffix}`);
        return response.items;
    }
    get(id) {
        return this.getJson(`/api/v1/catalogue/items/${encodeURIComponent(id)}`);
    }
    async search(query, limit = 50) {
        const params = new URLSearchParams({ q: query, limit: String(limit) });
        const response = await this.getJson(`/api/v1/catalogue/search?${params.toString()}`);
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
    fetch(path, accept, init = { method: 'GET' }) {
        const headers = new Headers(init.headers);
        headers.set('Accept', accept);
        if (this.bearerToken?.trim())
            headers.set('Authorization', `Bearer ${this.bearerToken.trim()}`);
        return fetch(`${this.baseUrl}${path}`, { ...init, headers });
    }
    async throwResponseError(response) {
        let body;
        try {
            body = await response.json();
        }
        catch {
            // The server normally returns JSON errors, but preserve the HTTP status if it does not.
        }
        const parsed = parseErrorEnvelope(body, `${response.status} ${response.statusText}`);
        throw new MachaApiError(`Macha catalogue request failed: ${parsed.message}`, response.status, parsed.code);
    }
}
