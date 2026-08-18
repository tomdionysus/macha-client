import { useMemo } from 'react';
import type { MediaApi } from '../api/MediaApi';
import { AlphabetIndex } from '../components/AlphabetIndex';
import { ErrorMessage, Loading } from '../components/Status';
import { MediaRow } from '../components/MediaRow';
import { useAlphabetIndex } from '../hooks/useAlphabetIndex';
import { useAsync } from '../hooks/useAsync';
import { sortMediaByIndexedTitle } from '../titleIndex';
import type { MediaSummary } from '../types';

interface Props {
  api: MediaApi;
  onOpen: (item: MediaSummary) => void;
}

export function MusicScreen({ api, onOpen }: Props) {
  const music = useAsync(async () => {
    const [artists, albums] = await Promise.all([api.artists(), api.albums()]);
    return { artists, albums };
  }, [api]);

  const artists = useMemo(() => sortMediaByIndexedTitle(music.value?.artists ?? []), [music.value?.artists]);
  const albums = useMemo(() => sortMediaByIndexedTitle(music.value?.albums ?? []), [music.value?.albums]);
  const indexedItems = useMemo(() => [...artists, ...albums], [artists, albums]);
  const alphabet = useAlphabetIndex(indexedItems);

  if (music.loading) return <Loading />;
  if (music.error) return <ErrorMessage error={music.error} />;
  if (!music.value) return null;

  return (
    <section className="catalogue-indexed">
      <h1>Music</h1>
      <MediaRow api={api} title="Artists" items={artists} onOpen={onOpen} itemRef={alphabet.registerItem} />
      <MediaRow api={api} title="Albums" items={albums} onOpen={onOpen} itemRef={alphabet.registerItem} />
      <AlphabetIndex availableKeys={alphabet.availableKeys} onSelect={alphabet.jumpTo} />
    </section>
  );
}
