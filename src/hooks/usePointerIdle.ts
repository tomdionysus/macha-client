import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Whether the pointer has rested for `delayMs`; any movement wakes it at once. For hiding the
 * cursor over video, separately from the chrome's own idle rules.
 */
export function usePointerIdle(delayMs: number): { idle: boolean; noteMovement: () => void } {
  const [idle, setIdle] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const noteMovement = useCallback(() => {
    setIdle(false);
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setIdle(true);
    }, delayMs);
  }, [delayMs]);

  useEffect(() => () => {
    if (timer.current !== undefined) clearTimeout(timer.current);
  }, []);

  return { idle, noteMovement };
}
