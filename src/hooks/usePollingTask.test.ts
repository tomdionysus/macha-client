// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PollingTask, usePollingTask } from './usePollingTask';

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

describe('usePollingTask effect wiring', () => {
  it('polls immediately on mount and again on the configured interval', async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn().mockResolvedValue(1);
      renderHook(() => usePollingTask({
        load, onValue: vi.fn(), onError: vi.fn(), intervalMs: 1_000, dependencies: ['a'],
      }));
      await vi.advanceTimersByTimeAsync(0);
      expect(load).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tears down the old task and starts a fresh one when a dependency changes', async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn().mockResolvedValue(1);
      const { rerender } = renderHook(
        (dependencies: readonly unknown[]) => usePollingTask({ load, onValue: vi.fn(), onError: vi.fn(), intervalMs: 1_000, dependencies }),
        { initialProps: ['a'] },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(load).toHaveBeenCalledTimes(1);

      rerender(['b']);
      await vi.advanceTimersByTimeAsync(0);
      // The dependency change must recreate the task (one immediate poll for
      // the new generation) rather than leaving the old interval running
      // unnoticed alongside a second one.
      expect(load).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(load).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling once unmounted', async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn().mockResolvedValue(1);
      const { unmount } = renderHook(() => usePollingTask({
        load, onValue: vi.fn(), onError: vi.fn(), intervalMs: 1_000, dependencies: [],
      }));
      await vi.advanceTimersByTimeAsync(0);
      expect(load).toHaveBeenCalledTimes(1);

      unmount();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never polls while disabled', async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn().mockResolvedValue(1);
      renderHook(() => usePollingTask({
        load, onValue: vi.fn(), onError: vi.fn(), intervalMs: 1_000, dependencies: [], enabled: false,
      }));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(load).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
