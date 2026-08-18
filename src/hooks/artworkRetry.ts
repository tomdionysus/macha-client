const DEFAULT_RETRY_DELAYS_MS = [300, 1500] as const;

interface RetryOptions {
  delaysMs?: readonly number[];
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isFinite(status) ? status : undefined;
}

export function isRetryableArtworkError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === undefined) return true;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function abortError(): DOMException {
  return new DOMException('Artwork request cancelled.', 'AbortError');
}

function defaultSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => window.setTimeout(resolve, delayMs));
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function fetchArtworkWithRetry(
  load: () => Promise<Blob>,
  signal?: AbortSignal,
  options: RetryOptions = {},
): Promise<Blob> {
  const delays = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  let failedAttempts = 0;

  while (true) {
    if (signal?.aborted) throw abortError();
    try {
      return await load();
    } catch (error) {
      const delayMs = delays[failedAttempts];
      failedAttempts += 1;
      if (delayMs === undefined || !isRetryableArtworkError(error)) throw error;
      await sleep(delayMs, signal);
    }
  }
}
