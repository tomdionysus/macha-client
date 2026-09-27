// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ListSort, SortKeyDef } from '../lists/listSort';
import { useListSort } from './ListSortControls';

type Key = 'added' | 'name';
const KEYS: readonly SortKeyDef<Key>[] = [
  { key: 'added', label: 'Added', direction: 'desc' },
  { key: 'name', label: 'Name', direction: 'asc' },
];
const FALLBACK: ListSort<Key> = { key: 'added', direction: 'desc' };

function renderAt(path: string) {
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
  return renderHook(() => ({ list: useListSort(KEYS, FALLBACK), location: useLocation() }), { wrapper });
}

describe("a list's page in the address", () => {
  it('reads the page from the address, counting from one there and from zero here', () => {
    expect(renderAt('/list?sort=name&dir=asc&page=2').result.current.list.page).toBe(1);
    expect(renderAt('/list').result.current.list.page).toBe(0);
    expect(renderAt('/list?page=0').result.current.list.page).toBe(0);
    expect(renderAt('/list?page=two').result.current.list.page).toBe(0);
  });

  it('keeps the page in the address beside the order, and leaves it out on the first page', () => {
    const { result } = renderAt('/list');
    act(() => result.current.list.setPage(1));
    expect(result.current.location.search).toBe('?sort=added&dir=desc&page=2');
    act(() => result.current.list.setPage(0));
    expect(result.current.location.search).toBe('?sort=added&dir=desc');
  });

  it('starts again at the first page when the order changes', () => {
    const { result } = renderAt('/list?sort=added&dir=desc&page=3');
    act(() => result.current.list.sortBy('name'));
    expect(result.current.location.search).toBe('?sort=name&dir=asc');
    expect(result.current.list.page).toBe(0);
  });
});
