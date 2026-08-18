const DEFAULT_RETRY_DELAYS_MS = [300, 1500];
function errorStatus(error) {
    if (!error || typeof error !== 'object')
        return undefined;
    const status = error.status;
    return typeof status === 'number' && Number.isFinite(status) ? status : undefined;
}
export function isRetryableArtworkError(error) {
    const status = errorStatus(error);
    if (status === undefined)
        return true;
    return status === 408 || status === 425 || status === 429 || status >= 500;
}
function abortError() {
    return new DOMException('Artwork request cancelled.', 'AbortError');
}
function defaultSleep(delayMs, signal) {
    if (!signal)
        return new Promise((resolve) => window.setTimeout(resolve, delayMs));
    if (signal.aborted)
        return Promise.reject(abortError());
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
export async function fetchArtworkWithRetry(load, signal, options = {}) {
    const delays = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    const sleep = options.sleep ?? defaultSleep;
    let failedAttempts = 0;
    while (true) {
        if (signal?.aborted)
            throw abortError();
        try {
            return await load();
        }
        catch (error) {
            const delayMs = delays[failedAttempts];
            failedAttempts += 1;
            if (delayMs === undefined || !isRetryableArtworkError(error))
                throw error;
            await sleep(delayMs, signal);
        }
    }
}
