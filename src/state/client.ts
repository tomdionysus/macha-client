const CLIENT_ID_KEY = 'macha-client-id';
const SERVER_URL_KEY = 'macha-server-url';
const INTERIM_SERVER_ENDPOINTS_KEY = 'macha-server-endpoints-v1';
const BOOTSTRAP_ENDPOINTS_KEY = 'macha-bootstrap-endpoints-v1';
const DISCOVERED_ENDPOINTS_KEY = 'macha-discovered-endpoints-v1';
const API_TOKEN_KEY = 'macha-api-token';
/** A cluster realistically has a handful of nodes; this only guards against a pathological advertisement. */
const MAX_DISCOVERED_ENDPOINTS = 16;

interface StoredEndpointList {
  version: 1;
  urls: string[];
}

export function getClientId(storage: Storage = localStorage): string {
  const existing = storage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;

  const id = createClientId();
  storage.setItem(CLIENT_ID_KEY, id);
  return id;
}

export function getServerUrl(storage: Storage = localStorage): string {
  return getBootstrapEndpoints(storage)[0] ?? '';
}

export function getBootstrapEndpoints(storage: Storage = localStorage): string[] {
  const env = environmentEndpoints();

  // The Samsung package is intentionally pinned to the build-time endpoint.
  // Do not allow stale localStorage from an earlier development install to
  // override it. Normal web builds retain the user-configurable behaviour.
  if (import.meta.env.MODE === 'samsung') {
    return env;
  }

  const stored = readStoredEndpointList(storage);
  if (stored) return stored;
  const interim = readStoredEndpointValue(storage, INTERIM_SERVER_ENDPOINTS_KEY);
  if (interim) {
    writeBootstrapEndpoints(interim, storage);
    storage.removeItem(INTERIM_SERVER_ENDPOINTS_KEY);
    return interim;
  }
  const configured = storage.getItem(SERVER_URL_KEY);
  if (configured !== null) {
    const migrated = normalizeUrls([configured]);
    writeBootstrapEndpoints(migrated, storage);
    storage.removeItem(SERVER_URL_KEY);
    return migrated;
  }
  return env;
}

export function setServerUrl(url: string, storage: Storage = localStorage): void {
  setBootstrapEndpoints([url], storage);
}

export function setBootstrapEndpoints(urls: readonly string[], storage: Storage = localStorage): void {
  writeBootstrapEndpoints(normalizeUrls(urls), storage);
  storage.removeItem(SERVER_URL_KEY);
  storage.removeItem(INTERIM_SERVER_ENDPOINTS_KEY);
}

/**
 * Endpoints this client has actually reached successfully at some point, but
 * never configured by the user — runtime-discovered cluster membership, not
 * bootstrap configuration (`docs/server-api.md`'s "Bootstrap and endpoint
 * discovery" section is explicit that discovered candidates must never be
 * persisted as user configuration). Purely a resumable-history hint for the
 * next reload's registry seed, never authoritative: the live cluster is
 * always free to supersede it. See `useEndpointHealthMonitor.ts`, which is
 * the only writer, and `App.tsx`, which merges it into the registry seed
 * under `EndpointSource.environment`.
 */
export function getDiscoveredEndpoints(storage: Storage = localStorage): string[] {
  return readStoredEndpointValue(storage, DISCOVERED_ENDPOINTS_KEY) ?? [];
}

export function setDiscoveredEndpoints(urls: readonly string[], storage: Storage = localStorage): void {
  const normalized = normalizeUrls(urls).slice(0, MAX_DISCOVERED_ENDPOINTS);
  if (normalized.length === 0) {
    storage.removeItem(DISCOVERED_ENDPOINTS_KEY);
    return;
  }
  writeEndpointValue(normalized, DISCOVERED_ENDPOINTS_KEY, storage);
}

export function getApiToken(storage: Storage = localStorage): string {
  return storage.getItem(API_TOKEN_KEY) ?? '';
}

export function setApiToken(token: string, storage: Storage = localStorage): void {
  const value = token.trim();
  if (value) storage.setItem(API_TOKEN_KEY, value);
  else storage.removeItem(API_TOKEN_KEY);
}

function normalizeUrl(url: string): string {
  const value = url.trim();
  if (!value || value === '/') return '';
  return value.replace(/\/+$/, '');
}

function normalizeUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    const normalized = normalizeUrl(url);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function environmentEndpoints(): string[] {
  const multiple = import.meta.env.VITE_MACHA_SERVERS as string | undefined;
  const single = import.meta.env.VITE_MACHA_SERVER as string | undefined;
  return normalizeUrls(multiple ? multiple.split(/[\n,]/) : single === undefined ? [] : [single]);
}

function readStoredEndpointList(storage: Storage): string[] | undefined {
  return readStoredEndpointValue(storage, BOOTSTRAP_ENDPOINTS_KEY);
}

function readStoredEndpointValue(storage: Storage, key: string): string[] | undefined {
  const raw = storage.getItem(key);
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid endpoint state');
    const record = value as Partial<StoredEndpointList>;
    if (record.version !== 1 || !Array.isArray(record.urls) || record.urls.some((url) => typeof url !== 'string')) {
      throw new Error('invalid endpoint state');
    }
    const normalized = normalizeUrls(record.urls);
    if (JSON.stringify(record.urls) !== JSON.stringify(normalized)) writeEndpointValue(normalized, key, storage);
    return normalized;
  } catch {
    storage.removeItem(key);
    return undefined;
  }
}

function writeEndpointValue(urls: string[], key: string, storage: Storage): void {
  const value: StoredEndpointList = { version: 1, urls };
  storage.setItem(key, JSON.stringify(value));
}

function writeBootstrapEndpoints(urls: string[], storage: Storage): void {
  writeEndpointValue(urls, BOOTSTRAP_ENDPOINTS_KEY, storage);
}

function createClientId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}
