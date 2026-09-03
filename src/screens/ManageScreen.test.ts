import { describe, expect, it, vi } from 'vitest';
import { pageSlice, pathBreadcrumbs, runBulkOperation } from './ManageScreen';

describe('ManageScreen helpers', () => {
  it('builds clickable cumulative MachaDFS path segments', () => {
    expect(pathBreadcrumbs('/Movies/Science Fiction')).toEqual([
      { label: 'MachaDFS', path: '/' },
      { label: 'Movies', path: '/Movies' },
      { label: 'Science Fiction', path: '/Movies/Science Fiction' },
    ]);
  });

  it('runs every selected operation and reports partial failures', async () => {
    const operation = vi.fn(async (id: string) => {
      if (id === 'broken') throw new Error('unavailable');
    });

    await expect(runBulkOperation(['one', 'broken', 'three'], operation)).resolves.toBe(1);
    expect(operation.mock.calls.map(([id]) => id)).toEqual(['one', 'broken', 'three']);
  });

  it('bounds list pages and slices without dropping the final partial page', () => {
    const items = Array.from({ length: 43 }, (_, index) => index);
    expect(pageSlice(items, 0).items).toEqual(items.slice(0, 20));
    expect(pageSlice(items, 2)).toEqual({ items: [40, 41, 42], page: 2, pageCount: 3 });
    expect(pageSlice(items, 99).page).toBe(2);
    expect(pageSlice([], 4)).toEqual({ items: [], page: 0, pageCount: 1 });
  });
});
