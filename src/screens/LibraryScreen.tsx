import { useMemo } from 'react';
import type { MediaApi } from '../api/MediaApi';
import type { MediaSummary } from '../types';
import { useRefreshableAsync } from '../hooks/useRefreshableAsync';
import { useAlphabetIndex } from '../hooks/useAlphabetIndex';
import { ErrorMessage, Loading } from '../components/Status';
import { MediaCard } from '../components/MediaCard';
import { AlphabetIndex } from '../components/AlphabetIndex';
import { sortMediaByIndexedTitle } from '../titleIndex';
import { MediaPageTitle } from '../components/MediaPageTitle';

interface Props {
  api: MediaApi;
  kind: 'movies' | 'shows';
  onOpen: (item: MediaSummary) => void;
}

export function LibraryScreen({ api, kind, onOpen }: Props) {
  const result = useRefreshableAsync(() => kind === 'movies' ? api.movies() : api.shows(), [api, kind]);
  const items = useMemo(() => sortMediaByIndexedTitle(result.value ?? []), [result.value]);
  const alphabet = useAlphabetIndex(items);

  const title = kind === 'movies' ? 'Movies' : 'TV Shows';
  if (!result.value) return <section className="catalogue-indexed">
    <MediaPageTitle refreshing={result.refreshing} onRefresh={result.refresh}>{title}</MediaPageTitle>
    {result.loading ? <Loading /> : result.error ? <ErrorMessage error={result.error} /> : null}
  </section>;

  return (
    <section className="catalogue-indexed">
      <MediaPageTitle refreshing={result.refreshing} onRefresh={result.refresh}>{title}</MediaPageTitle>
      {result.error && <p className="manage-error media-refresh-error">Refresh failed: {result.error.message}</p>}
      <div className="media-grid">
        {items.map((item) => (
          <MediaCard
            key={item.id}
            api={api}
            item={item}
            onOpen={onOpen}
            elementRef={(element) => alphabet.registerItem(item.id, element)}
          />
        ))}
      </div>
      <AlphabetIndex availableKeys={alphabet.availableKeys} onSelect={alphabet.jumpTo} />
    </section>
  );
}
