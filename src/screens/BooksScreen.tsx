import { useMemo } from 'react';
import { sortMediaByIndexedTitle, type MediaApi, type MediaSummary } from '@machafoundation/core';
import { AlphabetIndex } from '../components/AlphabetIndex';
import { MediaCard } from '../components/MediaCard';
import { MediaPageTitle } from '../components/MediaPageTitle';
import { ErrorMessage, Loading } from '../components/Status';
import { useAlphabetIndex } from '../hooks/useAlphabetIndex';
import { useRefreshableAsync } from '../hooks/useRefreshableAsync';

export type BooksSection = 'titles' | 'authors' | 'series';

const HEADINGS: Record<BooksSection, string> = { titles: 'Titles', authors: 'Authors', series: 'Series' };

/** Said when a list is empty: books appear only once a node with books turned on has scanned some. */
export const NO_BOOKS_TEXT = 'No books yet. Books appear once their files are in a node\'s books folder and that node has catalogued them.';

/** What each list says when it is empty: books with no author or series named leave those lists empty. */
const EMPTY_TEXT: Record<BooksSection, string> = {
  titles: NO_BOOKS_TEXT,
  authors: 'No authors yet. An author appears once a book names one.',
  series: 'No series yet. A series appears once a book names the series it belongs to.',
};

interface Props {
  api: MediaApi;
  section: BooksSection;
  onOpen: (item: MediaSummary) => void;
}

/** One of the Books lists, in title order with the letter index, as Music's are. */
export function BooksScreen({ api, section, onOpen }: Props) {
  const result = useRefreshableAsync((signal) => {
    if (section === 'authors') return api.authors(signal);
    if (section === 'series') return api.bookSeries(signal);
    return api.books(signal);
  }, [api, section]);
  const items = useMemo(() => sortMediaByIndexedTitle(result.value ?? []), [result.value]);
  const alphabet = useAlphabetIndex(items);

  if (!result.value) return <section className="catalogue-indexed books-browser">
    <MediaPageTitle refreshing={result.refreshing} onRefresh={result.refresh}>Books</MediaPageTitle>
    {result.loading ? <Loading /> : result.error ? <ErrorMessage error={result.error} /> : null}
  </section>;

  return (
    <section className="catalogue-indexed books-browser">
      <MediaPageTitle refreshing={result.refreshing} onRefresh={result.refresh}>Books</MediaPageTitle>
      {result.error && <p className="manage-error media-refresh-error">Refresh failed: {result.error.message}</p>}
      <h2 className="music-browser-heading">{HEADINGS[section]}</h2>
      {items.length === 0 && <p className="list-note">{EMPTY_TEXT[section]}</p>}
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
