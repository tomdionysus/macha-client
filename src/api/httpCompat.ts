export type HeaderValues = Record<string, string | undefined>;

export interface ParsedResponseBody {
  body: unknown;
  wasJson: boolean;
}

/**
 * Build a plain header object without relying on the Headers(init) constructor.
 * Older Tizen Chromium implements Fetch but only exposes the earliest Headers
 * constructor shape.
 */
export function mergeRequestHeaders(initial: HeadersInit | undefined, values: HeaderValues): Record<string, string> {
  const result: Record<string, string> = {};

  if (initial) {
    if (Array.isArray(initial)) {
      for (const pair of initial) result[pair[0]] = pair[1];
    } else {
      const iterable = initial as Headers;
      if (typeof iterable.forEach === 'function') {
        iterable.forEach((value, key) => { result[key] = value; });
      } else {
        const object = initial as Record<string, string>;
        for (const key of Object.keys(object)) result[key] = object[key];
      }
    }
  }

  for (const key of Object.keys(values)) {
    const value = values[key];
    if (value !== undefined) result[key] = value;
  }

  return result;
}

export function queryString(entries: ReadonlyArray<readonly [string, string | undefined]>): string {
  const parts: string[] = [];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.join('&');
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';
  return trimmed.replace(/\/+$/, '');
}

/**
 * A bearer token can be handed to an API client either as a fixed string
 * (tests, one-off manual overrides) or as a live `SessionTokenStore` whose
 * `.current` value can change after the client was constructed — e.g. an
 * anonymous session token that gets re-minted after it expires. Reading it
 * fresh at request time (instead of once at construction) means a refreshed
 * token reaches every already-constructed, long-lived client immediately.
 */
export type BearerTokenSource = string | undefined | { readonly current: string | undefined };

export function resolveBearerToken(source: BearerTokenSource): string | undefined {
  return typeof source === 'string' || source === undefined ? source : source.current;
}

export function authenticatedRequestHeaders(
  initial: HeadersInit | undefined,
  bearerToken: BearerTokenSource,
  values: HeaderValues = {},
): Record<string, string> {
  const token = resolveBearerToken(bearerToken)?.trim();
  return mergeRequestHeaders(initial, {
    Accept: 'application/json',
    Authorization: token ? `Bearer ${token}` : undefined,
    ...values,
  });
}

export async function readResponseBody(response: Response): Promise<ParsedResponseBody> {
  try {
    return { body: await response.json() as unknown, wasJson: true };
  } catch {
    return { body: undefined, wasJson: false };
  }
}
