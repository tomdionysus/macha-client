export const SERVER_UNREACHABLE_EVENT = 'macha:server-unreachable';

export const SERVER_UNREACHABLE_MESSAGE =
  'The Macha server cannot be reached. Check that the server is running and that the API address below is correct.';

export class MachaConnectionError extends Error {
  constructor(message = SERVER_UNREACHABLE_MESSAGE) {
    super(message);
    this.name = 'MachaConnectionError';
  }
}

export function isGatewayConnectionFailure(response: Response, bodyWasJson: boolean): boolean {
  if (response.status === 502 || response.status === 504) return true;
  return response.status === 500 && !bodyWasJson;
}

export function serverUnreachable(): MachaConnectionError {
  const error = new MachaConnectionError();
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(SERVER_UNREACHABLE_EVENT, {
      detail: { message: error.message },
    }));
  }
  return error;
}
