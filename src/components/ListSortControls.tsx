import type { ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listSortParams, parseListSort, type ListSort, type SortKeyDef } from '../lists/listSort';

/**
 * A list's order and page, kept in the address so the way back from an item
 * lands on the same order and page. A new order starts again at the first page.
 */
export function useListSort<K extends string>(keys: readonly SortKeyDef<K>[], fallback: ListSort<K>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = parseListSort(searchParams, keys, fallback);
  const pageParam = Number(searchParams.get('page'));
  const page = Number.isInteger(pageParam) && pageParam > 1 ? pageParam - 1 : 0;
  const search = searchParams.toString() ? `?${searchParams.toString()}` : '';
  const write = (next: ListSort<K>, nextPage: number) => setSearchParams(
    { ...listSortParams(next), ...(nextPage > 0 ? { page: String(nextPage + 1) } : {}) },
    { replace: true },
  );
  const setSort = (next: ListSort<K>) => write(next, 0);
  const setPage = (nextPage: number) => write(sort, nextPage);
  /** A header press: the same key again reverses it, a new one starts in its natural direction. */
  const sortBy = (key: K) => {
    if (sort.key === key) setSort({ key, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
    else setSort({ key, direction: keys.find((entry) => entry.key === key)!.direction });
  };
  return { sort, setSort, sortBy, page, setPage, search };
}

/** A column header that sorts, the way a torrent client's does. */
export function SortHeader<K extends string>({ label, sortKey, sort, onSort, className }: {
  label: string;
  sortKey: K;
  sort: ListSort<K>;
  onSort: (key: K) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={className} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'} scope="col">
      <button type="button" className={`sort-header${active ? ' active' : ''}`} onClick={() => onSort(sortKey)}>
        {label}
        {active && <span aria-hidden="true">{sort.direction === 'asc' ? ' ▴' : ' ▾'}</span>}
      </button>
    </th>
  );
}

/** The key picker and direction toggle beside a sortable list's heading. */
export function SortControl<K extends string>({ keys, sort, onChange }: {
  keys: readonly SortKeyDef<K>[];
  sort: ListSort<K>;
  onChange: (sort: ListSort<K>) => void;
}) {
  return (
    <div className="sort-control">
      <label>
        Sort by
        <select
          data-tv-focusable="true"
          value={sort.key}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => {
            const def = keys.find((entry) => entry.key === event.target.value);
            if (def) onChange({ key: def.key, direction: def.direction });
          }}
        >
          {keys.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
        </select>
      </label>
      <button
        type="button"
        className="secondary-button sort-direction"
        data-tv-focusable="true"
        aria-label={sort.direction === 'asc' ? 'Ascending; switch to descending' : 'Descending; switch to ascending'}
        onClick={() => onChange({ key: sort.key, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
      >
        {sort.direction === 'asc' ? 'Asc' : 'Desc'}
      </button>
    </div>
  );
}
