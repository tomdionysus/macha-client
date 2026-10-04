import { useEffect, useState } from 'react';

/**
 * Milliseconds since `active` became true; zero while inactive, restarting on
 * each activation. Reads the monotonic clock rather than counting ticks, which
 * a background tab throttles.
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
