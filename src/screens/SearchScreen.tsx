import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { DEFAULT_SEARCH_SORT, isMediaSortKey, isSearchable, orderMedia, SEARCH_SORTS, type MediaSortKey } from '@machafoundation/core';
import type { MediaApi } from '@machafoundation/core';
import type { MediaSummary } from '@machafoundation/core';
import { MediaCard } from '../components/MediaCard';
import { AlphabetIndex } from '../components/AlphabetIndex';
import { AsyncIconButton } from '../components/AsyncIconButton';
import { RefreshIcon } from '../components/ManageIcons';
import { MediaPageTitle } from '../components/MediaPageTitle';
import { useAlphabetIndex } from '../hooks/useAlphabetIndex';

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
  const alphabet = useAlphabetIndex(ordered);

  useEffect(() => {
    // Core decides what is worth a search: the words titles ignore for
    // ordering never trigger one, and never reach the catalogue.
    const normalized = query.trim();
    if (!isSearchable(normalized)) {
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
    <section className="catalogue-indexed">
      <MediaPageTitle>Search</MediaPageTitle>
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
            {SEARCH_SORTS.map((entry) => <option key={entry.key} value={entry.key}>{entry.choiceLabel}</option>)}
          </select>
        </div>
        <AsyncIconButton
          className="search-bar-refresh"
          label="Refresh Search"
          busy={refreshing}
          onClick={() => setRefreshToken((value) => value + 1)}
          icon={<RefreshIcon />}
        />
      </div>
      <div className="media-grid search-results">
        {ordered.map((item) => (
          <MediaCard
            key={item.id}
            api={api}
            item={item}
            onOpen={onOpen}
            variant="in-context"
            elementRef={(element) => alphabet.registerItem(item.id, element)}
          />
        ))}
      </div>
      {ordered.length > 0 && <AlphabetIndex availableKeys={alphabet.availableKeys} onSelect={alphabet.jumpTo} />}
    </section>
  );
}
