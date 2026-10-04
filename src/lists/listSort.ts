/** Sorting for a list a viewer can reorder by column. */
export type SortDirection = 'asc' | 'desc';

export interface ListSort<K extends string> {
  key: K;
  direction: SortDirection;
}

/** A sortable key, with its natural direction. */
export interface SortKeyDef<K extends string> {
  key: K;
  label: string;
  direction: SortDirection;
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareValues(left: number | string, right: number | string): number {
  if (typeof left === 'string' && typeof right === 'string') return COLLATOR.compare(left, right);
  return Number(left) - Number(right);
}

/**
 * A stable order: ties fall to the name, then the id, so a poll returning rows in another order
 * never swaps two under the pointer. Unknown (`undefined`) values sort last in either direction.
 */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  sort: ListSort<K>,
  valueOf: (row: T, key: K) => number | string | undefined,
  nameOf: (row: T) => string,
  idOf: (row: T) => string,
): T[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = valueOf(left, sort.key);
    const b = valueOf(right, sort.key);
    if (a === undefined && b !== undefined) return 1;
    if (b === undefined && a !== undefined) return -1;
    const primary = a !== undefined && b !== undefined ? sign * compareValues(a, b) : 0;
    const leftId = idOf(left);
    const rightId = idOf(right);
    return primary
      || COLLATOR.compare(nameOf(left), nameOf(right))
      || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0);
  });
}

/** Reads the sort from the address, falling back on anything invalid. */
export function parseListSort<K extends string>(params: URLSearchParams, keys: readonly SortKeyDef<K>[], fallback: ListSort<K>): ListSort<K> {
  const key = params.get('sort');
  const def = keys.find((entry) => entry.key === key);
  if (!def) return fallback;
  const direction = params.get('dir');
  return { key: def.key, direction: direction === 'asc' || direction === 'desc' ? direction : def.direction };
}

export function listSortParams<K extends string>(sort: ListSort<K>): Record<string, string> {
  return { sort: sort.key, dir: sort.direction };
}
