import { describe, expect, it } from 'vitest';
import type { MediaSummary } from '@machafoundation/core';
import { orderSearchResults } from './SearchScreen';

function item(id: string, title: string, catalogueUpdatedNs: number): MediaSummary {
  return { id, kind: 'movie', title, mediaIds: [], catalogueUpdatedNs } as MediaSummary;
}

describe('ordering search results', () => {
  const answered = [item('b', 'The Bravo', 1), item('c', 'Charlie', 3), item('a', 'Alpha', 2)];

  it('keeps the order the server answered in for relevance', () => {
    expect(orderSearchResults(answered, 'relevance').map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
  });

  it('orders by indexed title, ignoring a leading article', () => {
    expect(orderSearchResults(answered, 'title').map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts the most recently added first', () => {
    expect(orderSearchResults(answered, 'recent').map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
  });
});
