import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { newestCatalogueFirst, sortMediaByIndexedTitle } from '@machafoundation/core';
import type { MediaApi } from '@machafoundation/core';
import type { MediaSummary } from '@machafoundation/core';
import { MediaCard } from '../components/MediaCard';
import { MediaPageTitle } from '../components/MediaPageTitle';

/** Each order is core's; relevance is the order the server answered in. */
export const SEARCH_SORTS = [
  { key: 'relevance', label: 'Relevance', order: (items: MediaSummary[]) => items },
  { key: 'title', label: 'Title', order: sortMediaByIndexedTitle },
  { key: 'recent', label: 'Recently added', order: newestCatalogueFirst },
] as const;

export type SearchSortKey = (typeof SEARCH_SORTS)[number]['key'];

export function orderSearchResults(items: MediaSummary[], key: SearchSortKey): MediaSummary[] {
  return SEARCH_SORTS.find((entry) => entry.key === key)!.order(items);
}

interface Props {
  api: MediaApi;
  onOpen: (item: MediaSummary) => void;
}

export function SearchScreen({ api, onOpen }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MediaSummary[]>([]);
  const [error, setError] = useState<string>();
  const [refreshToken, setRefreshToken] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<SearchSortKey>('relevance');
  const ordered = useMemo(() => orderSearchResults(results, sort), [results, sort]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setResults([]);
      setError(undefined);
      setRefreshing(false);
      return;
    }
    let active = true;
    setRefreshing(true);
    setError(undefined);
    const timer = window.setTimeout(() => {
      void api.search(normalized)
        .then((value) => { if (active) setResults(value); })
        .catch((reason: unknown) => { if (active) setError(String(reason)); })
        .finally(() => { if (active) setRefreshing(false); });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, query, refreshToken]);

  return (
    <section>
      <MediaPageTitle refreshing={refreshing} onRefresh={() => setRefreshToken((value) => value + 1)}>Search</MediaPageTitle>
      {error && <p className="manage-error media-refresh-error">Refresh failed: {error}</p>}
      <div className="search-bar">
        <input
          className="search-input"
          data-tv-focusable="true"
          value={query}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
          placeholder="Search your library"
          autoFocus
        />
        <div className="sort-control">
          <label>
            Sort by
            <select
              data-tv-focusable="true"
              value={sort}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setSort(event.target.value as SearchSortKey)}
            >
              {SEARCH_SORTS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="media-grid search-results">
        {ordered.map((item) => <MediaCard key={item.id} api={api} item={item} onOpen={onOpen} />)}
      </div>
    </section>
  );
}
