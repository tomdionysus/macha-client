import { describe, expect, it } from 'vitest';
import { runInBatches } from './IngestJobDetailScreen';

describe('a bulk file action', () => {
  it('asks at most so many at once, every item once, and counts the failures', async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    const failed = await runInBatches([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, async (item) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      seen.push(item);
      if (item % 5 === 0) throw new Error('refused');
    });
    expect([peak, failed, seen.sort((a, b) => a - b)]).toEqual([4, 2, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]);
  });
});
