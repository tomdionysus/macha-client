import { mergeRequestHeaders, queryString } from './httpCompat';
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
        const query = queryString([['type', kind], ['parent', parent]]);
        const suffix = query ? `?${query}` : '';
        const response = await this.getJson(`/api/v1/catalogue/items${suffix}`);
        return response.items;
    }
    get(id) {
        return this.getJson(`/api/v1/catalogue/items/${encodeURIComponent(id)}`);
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
    fetch(path, accept, init = { method: 'GET' }) {
        const token = this.bearerToken?.trim();
        const headers = mergeRequestHeaders(init.headers, {
            Accept: accept,
            Authorization: token ? `Bearer ${token}` : undefined,
        });
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
