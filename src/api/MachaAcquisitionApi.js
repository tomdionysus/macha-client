import { parseErrorEnvelope } from './errorEnvelope';
import { mergeRequestHeaders } from './httpCompat';
import { isGatewayConnectionFailure, serverUnreachable } from './serverConnection';
export class MachaAcquisitionApiError extends Error {
    status;
    code;
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = 'MachaAcquisitionApiError';
    }
}
function normalizeBaseUrl(value) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '/')
        return '';
    return trimmed.replace(/\/+$/, '');
}
export class MachaAcquisitionApi {
    bearerToken;
    baseUrl;
    constructor(baseUrl, bearerToken) {
        this.bearerToken = bearerToken;
        this.baseUrl = normalizeBaseUrl(baseUrl);
    }
    async snapshot() {
        const [ingestStatus, torrentStatus, ingestJobs, torrentJobs] = await Promise.all([
            this.getJson('/api/v1/ingest/status'),
            this.getJson('/api/v1/torrents/status'),
            this.getJson('/api/v1/ingest/jobs'),
            this.getJson('/api/v1/torrents/jobs'),
        ]);
        return {
            ingestStatus,
            torrentStatus,
            ingestJobs: ingestJobs.jobs,
            torrentJobs: torrentJobs.jobs,
        };
    }
    async submitPath(path) {
        const response = await this.request('/api/v1/ingest/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, remove_source: false }),
        });
        return response.id;
    }
    async submitMagnet(magnet) {
        const response = await this.request('/api/v1/torrents/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ magnet }),
        });
        return response.id;
    }
    pauseIngest(id) { return this.ingestAction(id, 'pause'); }
    resumeIngest(id) { return this.ingestAction(id, 'resume'); }
    cancelIngest(id) { return this.ingestAction(id, 'cancel'); }
    pauseTorrent(id) { return this.torrentAction(id, 'pause'); }
    resumeTorrent(id) { return this.torrentAction(id, 'resume'); }
    cancelTorrent(id) { return this.torrentAction(id, 'cancel'); }
    ingestAction(id, action) {
        return this.request(`/api/v1/ingest/jobs/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    }
    torrentAction(id, action) {
        return this.request(`/api/v1/torrents/jobs/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    }
    getJson(path) {
        return this.request(path, { method: 'GET' });
    }
    async request(path, init) {
        const token = this.bearerToken?.trim();
        const headers = mergeRequestHeaders(init.headers, {
            Accept: 'application/json',
            Authorization: token ? `Bearer ${token}` : undefined,
        });
        let response;
        try {
            response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
        }
        catch {
            throw serverUnreachable();
        }
        if (!response.ok)
            await this.throwResponseError(response);
        return await response.json();
    }
    async throwResponseError(response) {
        let body;
        let bodyWasJson = false;
        try {
            body = await response.json();
            bodyWasJson = true;
        }
        catch {
            // A proxy-generated gateway failure may not contain a Macha JSON envelope.
        }
        if (isGatewayConnectionFailure(response, bodyWasJson))
            throw serverUnreachable();
        const parsed = parseErrorEnvelope(body, `${response.status} ${response.statusText}`);
        throw new MachaAcquisitionApiError(`Macha acquisition request failed: ${parsed.message}`, response.status, parsed.code);
    }
}
export class DemoAcquisitionApi {
    async snapshot() {
        return {
            ingestStatus: {
                enabled: false,
                staging: { path: '', limit_bytes: 0, disk_bytes: 0, reserved_bytes: 0, accounted_bytes: 0 },
            },
            torrentStatus: { enabled: false, build_available: false, search_enabled: false },
            ingestJobs: [],
            torrentJobs: [],
        };
    }
    submitPath() { return Promise.reject(new Error('Import is unavailable in demo mode.')); }
    submitMagnet() { return Promise.reject(new Error('Torrent acquisition is unavailable in demo mode.')); }
    pauseIngest() { return Promise.reject(new Error('Import is unavailable in demo mode.')); }
    resumeIngest() { return Promise.reject(new Error('Import is unavailable in demo mode.')); }
    cancelIngest() { return Promise.reject(new Error('Import is unavailable in demo mode.')); }
    pauseTorrent() { return Promise.reject(new Error('Torrent acquisition is unavailable in demo mode.')); }
    resumeTorrent() { return Promise.reject(new Error('Torrent acquisition is unavailable in demo mode.')); }
    cancelTorrent() { return Promise.reject(new Error('Torrent acquisition is unavailable in demo mode.')); }
}
