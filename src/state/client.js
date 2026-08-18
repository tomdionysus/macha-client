const CLIENT_ID_KEY = 'macha-client-id';
const SERVER_URL_KEY = 'macha-server-url';
const API_TOKEN_KEY = 'macha-api-token';
export function getClientId(storage = localStorage) {
    const existing = storage.getItem(CLIENT_ID_KEY);
    if (existing)
        return existing;
    const id = createClientId();
    storage.setItem(CLIENT_ID_KEY, id);
    return id;
}
export function getServerUrl(storage = localStorage) {
    const configured = storage.getItem(SERVER_URL_KEY);
    if (configured !== null)
        return configured;
    const env = import.meta.env.VITE_MACHA_SERVER;
    return env?.replace(/\/+$/, '') ?? '';
}
export function setServerUrl(url, storage = localStorage) {
    storage.setItem(SERVER_URL_KEY, normalizeUrl(url));
}
export function getApiToken(storage = localStorage) {
    return storage.getItem(API_TOKEN_KEY) ?? '';
}
export function setApiToken(token, storage = localStorage) {
    const value = token.trim();
    if (value)
        storage.setItem(API_TOKEN_KEY, value);
    else
        storage.removeItem(API_TOKEN_KEY);
}
function normalizeUrl(url) {
    const value = url.trim();
    if (!value || value === '/')
        return '';
    return value.replace(/\/+$/, '');
}
function createClientId() {
    if (typeof crypto.randomUUID === 'function')
        return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}
