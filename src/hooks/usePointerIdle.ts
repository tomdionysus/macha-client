import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Whether the pointer has rested for `delayMs`. A pointer that moves is awake
 * at once and rests again only after a full `delayMs` without movement.
 *
 * For hiding a cursor over video: the player's chrome and its cursor used to
 * share one flag, so a cursor hidden with the chrome stayed hidden while the
 * mouse moved anywhere but over the control bar. The cursor answers to the
 * pointer alone; the chrome keeps its own rules.
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
