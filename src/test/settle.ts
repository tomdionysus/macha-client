import { act } from '@testing-library/react';

/**
 * Lets every pending promise resolve and React render the result. A zero-delay timer fires only
 * once the microtask queue is empty, so the outcome never depends on machine speed. A fake that
 * waits on its own timer needs fake timers instead.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  });
}
