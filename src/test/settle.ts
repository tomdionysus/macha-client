import { act } from '@testing-library/react';

/**
 * Lets every pending promise resolve and React render what came of it, with
 * no deadline. A zero-delay timer runs only once the microtask queue is
 * empty, however long that takes, so the answer depends on order and never
 * on the machine's speed, which findBy and waitFor's one-second deadline do.
 * Fakes here resolve with Promise.resolve, so one pass settles a chain of
 * them; a fake that waits on a timer of its own needs fake timers instead.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  });
}
