import { MachaConnectionError } from '../api/serverConnection';

export type EndpointFailureKind = 'transport' | 'unavailable' | 'capacity' | 'session-missing';

export class MachaEndpointError extends Error {
  constructor(
    message: string,
    public readonly endpointId: string,
    public readonly baseUrl: string,
    public readonly kind: EndpointFailureKind,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MachaEndpointError';
  }
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export function retryableEndpointFailure(error: unknown): boolean {
  if (error instanceof MachaConnectionError || error instanceof MachaEndpointError) return true;
  // Browser Fetch reports connection refusal, DNS failure and CORS transport
  // failure as TypeError. API/schema errors use the typed HTTP errors below.
  if (error instanceof TypeError) return true;
  const status = errorStatus(error);
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export function endpointFailure(
  endpointId: string,
  baseUrl: string,
  error: unknown,
): MachaEndpointError {
  const status = errorStatus(error);
  const kind: EndpointFailureKind = status === 429
    ? 'capacity'
    : status === 404
      ? 'session-missing'
      : status === 502 || status === 503 || status === 504
        ? 'unavailable'
        : 'transport';
  const detail = error instanceof Error ? error.message : String(error);
  return new MachaEndpointError(`Macha endpoint ${endpointId} failed: ${detail}`, endpointId, baseUrl, kind, error);
}
