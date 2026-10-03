// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogueApi, CatalogueItem } from '@machafoundation/core';
import { useCurrentAvailability } from './useCurrentAvailability';
import { settle } from '../test/settle';

describe('stored titles\' availability', () => {
  it('reads each title\'s availability now, and leaves a title the catalogue cannot answer for unmarked', async () => {
    const catalogue = {
      get: vi.fn(async (id: string) => {
        if (id === 'gone') throw new Error('not found');
        return { id, availability: id === 'a' ? 'unavailable' : 'partial', availability_members: null } as unknown as CatalogueItem;
      }),
    } as Pick<CatalogueApi, 'get'>;
    const stored = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'gone', title: 'C' }];
    const { result } = renderHook(() => useCurrentAvailability(stored, catalogue));
    expect(result.current.map((item) => item.availability)).toEqual([undefined, undefined, undefined]);
    await settle();
    expect(result.current.map((item) => [item.id, item.availability])).toEqual([['a', 'unavailable'], ['b', 'partial'], ['gone', undefined]]);
    expect(catalogue.get).toHaveBeenCalledTimes(3);
  });
});
