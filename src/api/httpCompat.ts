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

export function authenticatedRequestHeaders(
  initial: HeadersInit | undefined,
  bearerToken: string | undefined,
  values: HeaderValues = {},
): Record<string, string> {
  const token = bearerToken?.trim();
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
