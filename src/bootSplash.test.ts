import { describe, expect, it } from 'vitest';
import { remainingSplashMs, waitForSplashMinimum, type SplashClock } from './bootSplash';

describe('boot splash timing', () => {
  it('never expires before the configured minimum lifetime', () => {
    expect(remainingSplashMs(100, 349, 3_000)).toBe(2_751);
    expect(remainingSplashMs(100, 3_099, 3_000)).toBe(1);
    expect(remainingSplashMs(100, 3_100, 3_000)).toBe(0);
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

    await waitForSplashMinimum(0, 3_000, clock);

    expect(now).toBe(3_000);
    expect(sleeps).toBeGreaterThan(1);
  });

  it('does not return a negative remainder after delayed timers', () => {
    expect(remainingSplashMs(100, 9_000, 3_000)).toBe(0);
  });
});
