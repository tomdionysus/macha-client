import { useEffect, useState } from 'react';

/**
 * How long something has been going on, for telling somebody.
 *
 * **Reads the clock rather than counting ticks.** A tab in the background has
 * its timers throttled, so an interval that adds a second per firing
 * under-reports a wait that really did take thirty — and a wait is exactly the
 * thing a viewer switches away from. The figure exists to be shown to a
 * person, so it has to be the truth about the wait rather than the truth about
 * the timer.
 *
 * Monotonic, because a system clock that steps while a viewer is waiting must
 * not make the wait appear to run backwards or jump.
 *
 * Zero while inactive, and restarted from zero each time it becomes active:
 * the question is always "how long has *this* one been going", never "how long
 * since some earlier one".
 */
export function useElapsedMs(active: boolean, tickMs = 1_000): number {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    setElapsedMs(0);
    if (!active) return undefined;
    const startedAt = performance.now();
    const timer = window.setInterval(
      () => setElapsedMs(Math.round(performance.now() - startedAt)),
      Math.max(1, tickMs),
    );
    return () => window.clearInterval(timer);
  }, [active, tickMs]);

  return elapsedMs;
}
