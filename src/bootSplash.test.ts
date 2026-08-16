import { describe, expect, it } from 'vitest';
import { remainingSplashMs, shouldShowBootSplash, waitForSplashMinimum, type SplashClock } from './bootSplash';

describe('boot splash timing', () => {
  it('shows on first navigation and reload but not browser history restoration', () => {
    expect(shouldShowBootSplash('navigate')).toBe(true);
    expect(shouldShowBootSplash('reload')).toBe(true);
    expect(shouldShowBootSplash('back_forward')).toBe(false);
  });

  it('never expires before the configured minimum lifetime', () => {
    expect(remainingSplashMs(100, 349, 2_000)).toBe(1_751);
    expect(remainingSplashMs(100, 2_099, 2_000)).toBe(1);
    expect(remainingSplashMs(100, 2_100, 2_000)).toBe(0);
  });

  it('rechecks monotonic elapsed time even if a timer wakes early', async () => {
    let now = 0;
    let sleeps = 0;
    const clock: SplashClock = {
      now: () => now,
      sleep: async (requestedMs) => {
        sleeps += 1;
        now += Math.min(requestedMs, 250);
      },
    };

    await waitForSplashMinimum(0, 2_000, clock);

    expect(now).toBe(2_000);
    expect(sleeps).toBeGreaterThan(1);
  });

  it('does not return a negative remainder after delayed timers', () => {
    expect(remainingSplashMs(100, 9_000, 2_000)).toBe(0);
  });
});
