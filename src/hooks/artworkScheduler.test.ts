import { describe, expect, it } from 'vitest';
import { ArtworkRequestScheduler } from './artworkScheduler';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve; });
  return { promise, resolve };
}

describe('ArtworkRequestScheduler', () => {
  it('never exceeds the configured request concurrency', async () => {
    const scheduler = new ArtworkRequestScheduler<number>(2);
    const gates = [deferred<number>(), deferred<number>(), deferred<number>(), deferred<number>()];
    let active = 0;
    let peak = 0;
    const handles = gates.map((gate, index) => scheduler.request(String(index), async () => {
      active += 1;
      peak = Math.max(peak, active);
      const result = await gate.promise;
      active -= 1;
      return result;
    }));

    await Promise.resolve();
    expect(active).toBe(2);
    gates[0].resolve(0);
    gates[1].resolve(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(2);
    gates[2].resolve(2);
    gates[3].resolve(3);
    await Promise.all(handles.map((handle) => handle.promise));
    expect(peak).toBe(2);
  });

  it('promotes visible work ahead of nearby queued work', async () => {
    const scheduler = new ArtworkRequestScheduler<string>(1);
    const gate = deferred<string>();
    const order: string[] = [];
    const first = scheduler.request('first', async () => gate.promise, 'visible');
    const nearby = scheduler.request('nearby', async () => { order.push('nearby'); return 'nearby'; }, 'nearby');
    const visible = scheduler.request('visible', async () => { order.push('visible'); return 'visible'; }, 'visible');

    gate.resolve('first');
    await first.promise;
    await Promise.all([nearby.promise, visible.promise]);
    expect(order).toEqual(['visible', 'nearby']);
  });

  it('coalesces duplicate artwork keys', async () => {
    const scheduler = new ArtworkRequestScheduler<string>(2);
    let loads = 0;
    const gate = deferred<string>();
    const first = scheduler.request('same', async () => { loads += 1; return gate.promise; });
    const second = scheduler.request('same', async () => { loads += 1; return 'wrong'; });

    expect(loads).toBe(1);
    gate.resolve('artwork');
    await expect(first.promise).resolves.toBe('artwork');
    await expect(second.promise).resolves.toBe('artwork');
    expect(loads).toBe(1);
  });

  it('drops queued work when its final subscriber cancels', async () => {
    const scheduler = new ArtworkRequestScheduler<string>(1);
    const gate = deferred<string>();
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
