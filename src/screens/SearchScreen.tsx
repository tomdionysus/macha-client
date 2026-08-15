import { useEffect, useState, type ChangeEvent } from 'react';
import type { MediaApi } from '../api/MediaApi';
import type { MediaSummary } from '../types';
import { MediaCard } from '../components/MediaCard';
import { ErrorMessage } from '../components/Status';

interface Props {
  api: MediaApi;
  onOpen: (item: MediaSummary) => void;
}

export function SearchScreen({ api, onOpen }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MediaSummary[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setResults([]);
      setError(undefined);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void api.search(normalized)
        .then((value) => { if (active) setResults(value); })
        .catch((reason: unknown) => { if (active) setError(String(reason)); });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, query]);

  if (error) return <ErrorMessage error={new Error(error)} />;

  return (
    <section>
      <h1>Search</h1>
      <input
        className="search-input"
        data-tv-focusable="true"
        value={query}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
        placeholder="Search your library"
        autoFocus
      />
      <div className="media-grid search-results">
        {results.map((item) => <MediaCard key={item.id} api={api} item={item} onOpen={onOpen} />)}
      </div>
    </section>
  );
}
