import { mergeRequestHeaders } from './httpCompat';
function normalizeBaseUrl(value) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '/')
        return '';
    return trimmed.replace(/\/+$/, '');
}
function objectValue(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : undefined;
}
function stringValue(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function reportedVersion(body, headers) {
    for (const key of ['server_version', 'version', 'macha_version']) {
        const value = stringValue(body[key]);
        if (value)
            return value;
    }
    const server = objectValue(body.server);
    const nested = server ? stringValue(server.version) : undefined;
    if (nested)
        return nested;
    for (const key of ['x-macha-version', 'x-server-version']) {
        const value = headers.get(key)?.trim();
        if (value)
            return value;
    }
    const serverHeader = headers.get('server')?.trim() ?? '';
    const match = /^macha(?:\/|\s+)([^\s]+)$/i.exec(serverHeader);
    return match?.[1] ?? null;
}
export class MachaServerApi {
    bearerToken;
    baseUrl;
    constructor(baseUrl, bearerToken) {
        this.bearerToken = bearerToken;
        this.baseUrl = normalizeBaseUrl(baseUrl);
    }
    async status() {
        const token = this.bearerToken?.trim();
        const headers = mergeRequestHeaders(undefined, {
            Accept: 'application/json',
            Authorization: token ? `Bearer ${token}` : undefined,
        });
        const response = await fetch(`${this.baseUrl}/api/v1/playback/status`, { method: 'GET', headers });
        let playback = {};
        try {
            playback = objectValue(await response.json()) ?? {};
        }
        catch {
            // An HTTP response still proves that the configured server is reachable.
        }
        const message = stringValue(playback.message)
            ?? stringValue(playback.error)
            ?? (response.ok ? null : `${response.status} ${response.statusText}`);
        return {
            version: reportedVersion(playback, response.headers),
            playback,
            playbackAvailable: response.ok,
            httpStatus: response.status,
            message,
        };
    }
}
export class DemoServerApi {
    async status() {
        return {
            version: 'demo',
            playback: { enabled: true, ready: true, mode: 'demo' },
            playbackAvailable: true,
            httpStatus: 200,
            message: null,
        };
    }
}
