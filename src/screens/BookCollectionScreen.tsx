import type { AuthorDetails, BookSeriesDetails, MediaApi, MediaSummary } from '@machafoundation/core';
import { AvailabilityNote } from '../components/Availability';
import { EditButton } from '../components/EditButton';
import { MediaCard } from '../components/MediaCard';
import { MediaPageTitle } from '../components/MediaPageTitle';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useRefreshableAsync } from '../hooks/useRefreshableAsync';
import { bookAuthorsText, bookNumberLabel } from '../text/viewerText';
import { NO_BOOKS_TEXT } from './BooksScreen';

interface Props {
  api: MediaApi;
  kind: 'author' | 'series';
  id: string;
  onBack: () => void;
  onOpenBook: (book: MediaSummary) => void;
  onEdit?: () => void;
}

/**
 * A book's second line on a collection's page. By an author, oldest first: the year. In a series,
 * in its order: the book's place, and who wrote it, since a series can change author. Empty for
 * none, which leaves the line out rather than falling back to the card's own.
 */
function bookLine(book: MediaSummary, kind: Props['kind'], seriesId: string): string {
  if (kind === 'author') return book.year !== undefined ? String(book.year) : '';
  const place = bookNumberLabel(book.bookContext?.series.find((entry) => entry.id === seriesId)?.index);
  return [place, bookAuthorsText(book)].filter(Boolean).join(' · ');
}

/** An author's books, oldest first, or a series' books in its order; core orders both. */
export function BookCollectionScreen({ api, kind, id, onBack, onOpenBook, onEdit }: Props) {
  const details = useRefreshableAsync((signal) => api.details(id, signal), [api, id]);
  const collection = details.value?.kind === kind && 'books' in details.value
    ? details.value as AuthorDetails | BookSeriesDetails
    : undefined;
  const backdrop = useArtworkUrl(api, collection?.artwork?.backdrop ?? collection?.artwork?.poster);
  const noun = kind === 'author' ? 'Author' : 'Series';
  const back = <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Books</button>;

  if (!details.value) return <section className="detail book-collection"><div className="detail-content series-content">
    {back}
    <MediaPageTitle refreshing={details.refreshing} onRefresh={details.refresh}>{noun}</MediaPageTitle>
    {details.loading ? <Loading /> : details.error ? <ErrorMessage error={details.error} /> : null}
  </div></section>;
  if (!collection) return <ErrorMessage error={new Error(`Catalogue item is not ${kind === 'author' ? 'an author' : 'a book series'}.`)} />;

  return (
    <section className="detail book-collection">
      {backdrop && <div className="detail-backdrop" style={{ backgroundImage: `url(${JSON.stringify(backdrop)})` }} />}
      <div className="detail-content series-content">
        {back}
        {onEdit && <EditButton onClick={onEdit} />}
        <p className="eyebrow">{noun}</p>
        <MediaPageTitle refreshing={details.refreshing} onRefresh={details.refresh}>{collection.title}</MediaPageTitle>
        <AvailabilityNote item={collection} />
        {details.error && <p className="manage-error media-refresh-error">Refresh failed: {details.error.message}</p>}
        {collection.synopsis && <p className="synopsis">{collection.synopsis}</p>}
        <h2>Books</h2>
        {collection.books.length === 0 && <p className="list-note">{NO_BOOKS_TEXT}</p>}
        <div className="media-grid">
          {collection.books.map((book) => (
            <MediaCard key={book.id} api={api} item={book} onOpen={onOpenBook} subtitle={bookLine(book, kind, collection.id)} />
          ))}
        </div>
      </div>
    </section>
  );
}
