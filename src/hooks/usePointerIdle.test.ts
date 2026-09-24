// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePointerIdle } from './usePointerIdle';

describe('a pointer that moves is shown, and hidden again once it rests', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts idle, wakes on movement, and rests again after the delay', () => {
    const { result } = renderHook(() => usePointerIdle(3_000));
    expect(result.current.idle).toBe(true);

    act(() => result.current.noteMovement());
    expect(result.current.idle).toBe(false);

    act(() => { vi.advanceTimersByTime(2_999); });
    expect(result.current.idle).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.idle).toBe(true);
  });

  it('keeps a pointer that keeps moving awake', () => {
    const { result } = renderHook(() => usePointerIdle(3_000));
    for (let step = 0; step < 5; step += 1) {
      act(() => result.current.noteMovement());
      act(() => { vi.advanceTimersByTime(2_000); });
    }
    expect(result.current.idle).toBe(false);
  });
});
