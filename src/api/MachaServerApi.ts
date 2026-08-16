export interface ServerStatus {
  version: string | null;
  playback: Record<string, unknown>;
  playbackAvailable: boolean;
  httpStatus: number;
  message: string | null;
}

export interface ServerApi {
  status(): Promise<ServerStatus>;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';
  return trimmed.replace(/\/+$/, '');
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function reportedVersion(body: Record<string, unknown>, headers: Headers): string | null {
  for (const key of ['version', 'server_version', 'macha_version']) {
    const value = stringValue(body[key]);
    if (value) return value;
  }

  const server = objectValue(body.server);
  const nested = server ? stringValue(server.version) : undefined;
  if (nested) return nested;

  for (const key of ['x-macha-version', 'x-server-version']) {
    const value = headers.get(key)?.trim();
    if (value) return value;
  }

  const serverHeader = headers.get('server')?.trim() ?? '';
  const match = /^macha(?:\/|\s+)([^\s]+)$/i.exec(serverHeader);
  return match?.[1] ?? null;
}

export class MachaServerApi implements ServerApi {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly bearerToken?: string,
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  async status(): Promise<ServerStatus> {
    const headers = new Headers({ Accept: 'application/json' });
    if (this.bearerToken?.trim()) headers.set('Authorization', `Bearer ${this.bearerToken.trim()}`);

    const response = await fetch(`${this.baseUrl}/api/v1/playback/status`, { method: 'GET', headers });
    let playback: Record<string, unknown> = {};
    try {
      playback = objectValue(await response.json() as unknown) ?? {};
    } catch {
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

export class DemoServerApi implements ServerApi {
  async status(): Promise<ServerStatus> {
    return {
      version: 'demo',
      playback: { enabled: true, ready: true, mode: 'demo' },
      playbackAvailable: true,
      httpStatus: 200,
      message: null,
    };
  }
}
