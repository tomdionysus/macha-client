import { describe, expect, it, vi } from 'vitest';
import { PollingTask } from './usePollingTask';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('PollingTask', () => {
  it('does not overlap slow polls by default', async () => {
    const first = deferred<number>();
    const load = vi.fn(() => first.promise);
    const onValue = vi.fn();
    const task = new PollingTask(load, onValue, vi.fn());
    const running = task.run();
    await task.run();
    expect(load).toHaveBeenCalledTimes(1);
    first.resolve(1);
    await running;
    expect(onValue).toHaveBeenCalledWith(1);
  });

  it('allows overlap when matching an existing polling contract', async () => {
    const pending = [deferred<number>(), deferred<number>()];
    const load = vi.fn(() => pending[load.mock.calls.length - 1].promise);
    const task = new PollingTask(load, vi.fn(), vi.fn(), true);
    const one = task.run();
    const two = task.run();
    expect(load).toHaveBeenCalledTimes(2);
    pending[0].resolve(1);
    pending[1].resolve(2);
    await Promise.all([one, two]);
  });

  it('suppresses late results and errors after stop', async () => {
    const pending = deferred<number>();
    const onValue = vi.fn();
    const onError = vi.fn();
    const task = new PollingTask(() => pending.promise, onValue, onError);
    const running = task.run();
    task.stop();
    pending.resolve(1);
    await running;
    expect(onValue).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
