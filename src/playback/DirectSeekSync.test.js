import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectSeekSessionSync } from './DirectSeekSync';
function session(seekMs) {
    return { sessionId: 's1', seekMs };
}
afterEach(() => {
    vi.useRealTimers();
});
describe('DirectSeekSessionSync', () => {
    it('coalesces rapid seeks and sends only the latest position', async () => {
        vi.useFakeTimers();
        const update = vi.fn(async (_sessionId, positionMs) => session(positionMs));
        const applied = vi.fn();
        const failed = vi.fn();
        const sync = new DirectSeekSessionSync(update, applied, failed, 180);
        sync.schedule('s1', 10_000);
        sync.schedule('s1', 20_000);
        sync.schedule('s1', 30_000);
        await vi.advanceTimersByTimeAsync(180);
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith('s1', 30_000);
        expect(applied).toHaveBeenCalledTimes(1);
        expect(applied.mock.calls[0][0].seekMs).toBe(30_000);
        expect(failed).not.toHaveBeenCalled();
    });
    it('serializes a newer seek behind an in-flight mutation and discards the stale response', async () => {
        vi.useFakeTimers();
        let resolveFirst;
        const update = vi.fn((_sessionId, positionMs) => {
            if (update.mock.calls.length === 1) {
                return new Promise((resolve) => { resolveFirst = resolve; });
            }
            return Promise.resolve(session(positionMs));
        });
        const applied = vi.fn();
        const sync = new DirectSeekSessionSync(update, applied, vi.fn(), 100);
        sync.schedule('s1', 10_000);
        await vi.advanceTimersByTimeAsync(100);
        expect(update).toHaveBeenCalledTimes(1);
        sync.schedule('s1', 55_000);
        resolveFirst(session(10_000));
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        expect(update).toHaveBeenCalledTimes(2);
        expect(update.mock.calls[1]).toEqual(['s1', 55_000]);
        expect(applied).toHaveBeenCalledTimes(1);
        expect(applied.mock.calls[0][0].seekMs).toBe(55_000);
    });
    it('can drop a queued mutation when another session update supersedes it', async () => {
        vi.useFakeTimers();
        const update = vi.fn(async (_sessionId, positionMs) => session(positionMs));
        const sync = new DirectSeekSessionSync(update, vi.fn(), vi.fn(), 100);
        sync.schedule('s1', 42_000);
        sync.clearPending();
        await vi.advanceTimersByTimeAsync(200);
        expect(update).not.toHaveBeenCalled();
    });
});
