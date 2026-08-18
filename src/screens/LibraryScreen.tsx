import { useMemo } from 'react';
import type { MediaApi } from '../api/MediaApi';
import type { MediaSummary } from '../types';
import { useAsync } from '../hooks/useAsync';
import { useAlphabetIndex } from '../hooks/useAlphabetIndex';
import { ErrorMessage, Loading } from '../components/Status';
import { MediaCard } from '../components/MediaCard';
import { AlphabetIndex } from '../components/AlphabetIndex';
import { sortMediaByIndexedTitle } from '../titleIndex';

interface Props {
  api: MediaApi;
  kind: 'movies' | 'shows';
  onOpen: (item: MediaSummary) => void;
}

export function LibraryScreen({ api, kind, onOpen }: Props) {
  const result = useAsync(() => kind === 'movies' ? api.movies() : api.shows(), [api, kind]);
  const items = useMemo(() => sortMediaByIndexedTitle(result.value ?? []), [result.value]);
  const alphabet = useAlphabetIndex(items);

  if (result.loading) return <Loading />;
  if (result.error) return <ErrorMessage error={result.error} />;

  return (
    <section className="catalogue-indexed">
      <h1>{kind === 'movies' ? 'Movies' : 'TV Shows'}</h1>
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
