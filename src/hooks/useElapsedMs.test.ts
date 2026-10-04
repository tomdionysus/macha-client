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
    // Background tabs throttle timers, so counting ticks under-reports. The clock advances thirty
    // seconds against a single firing, which a tick-counter would read as 1,000.
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
