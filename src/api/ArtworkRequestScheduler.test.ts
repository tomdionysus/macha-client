import { describe, expect, it } from 'vitest';
import { ArtworkRequestScheduler } from './ArtworkRequestScheduler';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe('ArtworkRequestScheduler', () => {
  it('bounds concurrent artwork work', async () => {
    const scheduler = new ArtworkRequestScheduler(2);
    const first = deferred<number>();
    const second = deferred<number>();
    const starts: number[] = [];

    const one = scheduler.schedule(() => { starts.push(1); return first.promise; }, 'background');
    const two = scheduler.schedule(() => { starts.push(2); return second.promise; }, 'background');
    const three = scheduler.schedule(async () => { starts.push(3); return 3; }, 'background');

    expect(starts).toEqual([1, 2]);
    expect(scheduler.activeCount).toBe(2);
    expect(scheduler.queuedCount).toBe(1);
    first.resolve(1);
    await expect(one).resolves.toBe(1);
    await expect(three).resolves.toBe(3);
    second.resolve(2);
    await expect(two).resolves.toBe(2);
    expect(starts).toEqual([1, 2, 3]);
  });

  it('starts queued foreground artwork before queued grid posters', async () => {
    const scheduler = new ArtworkRequestScheduler(1);
    const blocker = deferred<void>();
    const order: string[] = [];

    const active = scheduler.schedule(() => { order.push('active'); return blocker.promise; }, 'background');
    const background = scheduler.schedule(async () => { order.push('background'); }, 'background');
    const foreground = scheduler.schedule(async () => { order.push('foreground'); }, 'foreground');

    blocker.resolve();
    await active;
    await foreground;
    await background;
    expect(order).toEqual(['active', 'foreground', 'background']);
  });
});
