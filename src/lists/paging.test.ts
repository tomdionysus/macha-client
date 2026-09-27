import { describe, expect, it } from 'vitest';
import { LIST_PAGE_SIZE, pageSlice } from './paging';

describe('a page of a list', () => {
  it('slices without dropping the final partial page, and clamps an out-of-range page', () => {
    const items = Array.from({ length: 43 }, (_, index) => index);
    expect(pageSlice(items, 0, 20).items).toEqual(items.slice(0, 20));
    expect(pageSlice(items, 2, 20)).toEqual({ items: [40, 41, 42], page: 2, pageCount: 3, first: 41, last: 43 });
    expect(pageSlice(items, 99, 20).page).toBe(2);
    expect(pageSlice([], 4, 20)).toEqual({ items: [], page: 0, pageCount: 1, first: 0, last: 0 });
  });

  it('is fifty rows unless asked otherwise', () => {
    const items = Array.from({ length: 60 }, (_, index) => index);
    expect(LIST_PAGE_SIZE).toBe(50);
    expect(pageSlice(items, 0)).toMatchObject({ page: 0, pageCount: 2, first: 1, last: 50 });
    expect(pageSlice(items, 1)).toMatchObject({ items: items.slice(50), first: 51, last: 60 });
  });
});
