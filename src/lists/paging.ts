/** Rows per page in a slim job or file list. */
export const LIST_PAGE_SIZE = 50;

/**
 * One page of a list, with the page clamped into range, so a page number
 * carried in the address from a longer list never shows an empty page.
 */
export function pageSlice<T>(items: readonly T[], page: number, pageSize = LIST_PAGE_SIZE): {
  items: T[];
  page: number;
  pageCount: number;
  first: number;
  last: number;
} {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const bounded = Math.min(Math.max(0, page), pageCount - 1);
  const start = bounded * pageSize;
  const slice = items.slice(start, start + pageSize);
  return { items: slice, page: bounded, pageCount, first: slice.length ? start + 1 : 0, last: start + slice.length };
}
