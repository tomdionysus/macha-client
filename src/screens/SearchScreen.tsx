import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { DEFAULT_SEARCH_SORT, isMediaSortKey, orderMedia, SEARCH_SORTS, type MediaSortKey } from '@machafoundation/core';
import type { MediaApi } from '@machafoundation/core';
import type { MediaSummary } from '@machafoundation/core';
import { MediaCard } from '../components/MediaCard';
import { MediaPageTitle } from '../components/MediaPageTitle';

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
  const [sort, setSort] = useState<MediaSortKey>(DEFAULT_SEARCH_SORT);
  const ordered = useMemo(() => orderMedia(results, sort), [results, sort]);

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
          <select
            data-tv-focusable="true"
            aria-label="Sort results"
            value={sort}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => { if (isMediaSortKey(event.target.value)) setSort(event.target.value); }}
          >
            {SEARCH_SORTS.map((entry) => <option key={entry.key} value={entry.key}>Sort By {entry.label}</option>)}
          </select>
        </div>
      </div>
      <div className="media-grid search-results">
        {ordered.map((item) => <MediaCard key={item.id} api={api} item={item} onOpen={onOpen} />)}
      </div>
    </section>
  );
}
