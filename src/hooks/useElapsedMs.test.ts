// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useElapsedMs } from './useElapsedMs';

describe('how long this has been going on', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('counts from the moment it became active', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useElapsedMs(true));

    expect(result.current).toBe(0);
    act(() => { vi.advanceTimersByTime(12_000); });
    expect(result.current).toBe(12_000);
  });

  it('reads the clock rather than counting ticks', () => {
    // A tab in the background has its timers throttled, so an interval that
    // adds a second per firing under-reports a wait that really did take
    // thirty — and a wait is exactly the thing a viewer switches away from.
    // The number exists to be told to somebody, so it has to be the truth
    // about the wait rather than the truth about the timer.
    //
    // The clock is driven independently of the timer here on purpose:
    // advancing both together cannot tell the two implementations apart, and a
    // test that agrees with whichever one is written is not a test. Thirty
    // seconds of clock against a single firing is the throttled tab in
    // miniature, and a tick-counter answers 1,000 to it.
    vi.useFakeTimers();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { result } = renderHook(() => useElapsedMs(true));

    clock.mockReturnValue(30_000);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current).toBe(30_000);
  });

  it('is nothing at all while inactive, and starts again from zero', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ active }) => useElapsedMs(active), {
      initialProps: { active: false },
    });

    act(() => { vi.advanceTimersByTime(9_000); });
    expect(result.current).toBe(0);

    rerender({ active: true });
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(result.current).toBe(3_000);

    rerender({ active: false });
    expect(result.current).toBe(0);
  });
});
