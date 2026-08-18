import { describe, expect, it } from 'vitest';
import { fetchArtworkWithRetry, isRetryableArtworkError } from './artworkRetry';
describe('artwork retry', () => {
    it('retries transient failures with bounded backoff', async () => {
        const delays = [];
        let attempts = 0;
        const controller = new AbortController();
        const blob = new Blob(['artwork']);
        const result = await fetchArtworkWithRetry(async () => {
            attempts += 1;
            if (attempts < 3)
                throw new TypeError('network failure');
            return blob;
        }, controller.signal, {
            delaysMs: [10, 20],
            sleep: async (delayMs) => { delays.push(delayMs); },
        });
        expect(result).toBe(blob);
        expect(attempts).toBe(3);
        expect(delays).toEqual([10, 20]);
    });
    it('does not retry permanent HTTP errors', async () => {
        const error = Object.assign(new Error('not found'), { status: 404 });
        let attempts = 0;
        const controller = new AbortController();
        await expect(fetchArtworkWithRetry(async () => {
            attempts += 1;
            throw error;
        }, controller.signal, {
            delaysMs: [10, 20],
            sleep: async () => undefined,
        })).rejects.toBe(error);
        expect(attempts).toBe(1);
    });
    it('retries timeout, throttling and server errors', () => {
        expect(isRetryableArtworkError(Object.assign(new Error(), { status: 408 }))).toBe(true);
        expect(isRetryableArtworkError(Object.assign(new Error(), { status: 429 }))).toBe(true);
        expect(isRetryableArtworkError(Object.assign(new Error(), { status: 503 }))).toBe(true);
        expect(isRetryableArtworkError(Object.assign(new Error(), { status: 401 }))).toBe(false);
    });
});
