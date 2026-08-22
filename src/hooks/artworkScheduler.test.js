import { describe, expect, it } from 'vitest';
import { ArtworkRequestScheduler } from './artworkScheduler';
function deferred() {
    let resolve;
    const promise = new Promise((promiseResolve) => { resolve = promiseResolve; });
    return { promise, resolve };
}
describe('ArtworkRequestScheduler', () => {
    it('never exceeds the configured request concurrency', async () => {
        const scheduler = new ArtworkRequestScheduler(2);
        const gates = [deferred(), deferred(), deferred(), deferred()];
        const started = [deferred(), deferred(), deferred(), deferred()];
        let active = 0;
        let peak = 0;
        const handles = gates.map((gate, index) => scheduler.request(String(index), async () => {
            active += 1;
            peak = Math.max(peak, active);
            started[index].resolve();
            const result = await gate.promise;
            active -= 1;
            return result;
        }));
        await Promise.all([started[0].promise, started[1].promise]);
        expect(active).toBe(2);
        gates[0].resolve(0);
        gates[1].resolve(1);
        await Promise.all([started[2].promise, started[3].promise]);
        expect(active).toBe(2);
        gates[2].resolve(2);
        gates[3].resolve(3);
        await Promise.all(handles.map((handle) => handle.promise));
        expect(peak).toBe(2);
    });
    it('promotes visible work ahead of nearby queued work', async () => {
        const scheduler = new ArtworkRequestScheduler(1);
        const gate = deferred();
        const order = [];
        const first = scheduler.request('first', async () => gate.promise, 'visible');
        const nearby = scheduler.request('nearby', async () => { order.push('nearby'); return 'nearby'; }, 'nearby');
        const visible = scheduler.request('visible', async () => { order.push('visible'); return 'visible'; }, 'visible');
        gate.resolve('first');
        await first.promise;
        await Promise.all([nearby.promise, visible.promise]);
        expect(order).toEqual(['visible', 'nearby']);
    });
    it('coalesces duplicate artwork keys', async () => {
        const scheduler = new ArtworkRequestScheduler(2);
        let loads = 0;
        const gate = deferred();
        const started = deferred();
        const first = scheduler.request('same', async () => { loads += 1; started.resolve(); return gate.promise; });
        const second = scheduler.request('same', async () => { loads += 1; return 'wrong'; });
        await started.promise;
        expect(loads).toBe(1);
        gate.resolve('artwork');
        await expect(first.promise).resolves.toBe('artwork');
        await expect(second.promise).resolves.toBe('artwork');
        expect(loads).toBe(1);
    });
    it('drops queued work when its final subscriber cancels', async () => {
        const scheduler = new ArtworkRequestScheduler(1);
        const gate = deferred();
        const first = scheduler.request('first', async () => gate.promise);
        let loads = 0;
        const queued = scheduler.request('queued', async () => { loads += 1; return 'queued'; });
        void queued.promise.catch(() => undefined);
        queued.cancel();
        gate.resolve('first');
        await first.promise;
        await Promise.resolve();
        expect(loads).toBe(0);
    });
});
