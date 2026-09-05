import { mergeRequestHeaders, normalizeBaseUrl, readResponseBody } from './httpCompat';
import { isGatewayConnectionFailure, serverUnreachable } from './serverConnection';
import type { EndpointRegistry } from '../cluster/EndpointRegistry';

export interface AnonymousSession {
  token: string;
  expiresAtMs: number;
}

export class SessionAuthError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

/** `POST /api/v1/session` — the one endpoint that takes no Authorization header. */
export async function mintAnonymousSession(baseUrl: string): Promise<AnonymousSession> {
  const url = `${normalizeBaseUrl(baseUrl)}/api/v1/session`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: mergeRequestHeaders(undefined, { Accept: 'application/json', 'Content-Type': 'application/json' }),
      body: '{}',
    });
  } catch {
    throw serverUnreachable();
  }
  const { body, wasJson } = await readResponseBody(response);
  if (isGatewayConnectionFailure(response, wasJson)) throw serverUnreachable();
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined;
  if (!response.ok) {
    const message = typeof record?.message === 'string' ? record.message : `${response.status} ${response.statusText}`;
    throw new SessionAuthError(`Could not start a session: ${message}`, response.status);
  }
  const token = typeof record?.token === 'string' ? record.token : undefined;
  const expiresAtMs = typeof record?.expires_unix_ms === 'number' ? record.expires_unix_ms : undefined;
  if (!token || expiresAtMs === undefined) throw new SessionAuthError('Server returned a malformed session response.');
  return { token, expiresAtMs };
}

/**
 * Mints against whichever known endpoint answers first, in the same
 * any-node spirit as the rest of the cluster client: a session obtained from
 * any node is valid cluster-wide, so a single down node must not block
 * getting a token.
 */
export async function mintAnonymousSessionAnyNode(registry: EndpointRegistry): Promise<AnonymousSession> {
  let lastError: unknown;
  for (const { endpoint } of registry.candidates()) {
    try {
      const session = await mintAnonymousSession(endpoint.baseUrl);
      registry.recordSuccess(endpoint.id);
      return session;
    } catch (error) {
      registry.recordFailure(endpoint.id);
      lastError = error;
    }
  }
  throw lastError ?? new SessionAuthError('No Macha endpoint is configured.');
}
