import { Fragment, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { routes, type CatalogueApi, type ConversionFormat, type MediaApi, type ReadingPositionStore } from '@machafoundation/core';
import { AvailabilityNote } from '../components/Availability';
import { EditButton } from '../components/EditButton';
import { Facts } from '../components/ListParts';
import { MediaPageTitle } from '../components/MediaPageTitle';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useAsync } from '../hooks/useAsync';
import { useRefreshableAsync } from '../hooks/useRefreshableAsync';
import { seriesPlaceText, viewerErrorText, publishedText } from '../text/viewerText';
import { formatBytes } from './ingest/format';
import { downloadBookFile, languageName, readableHere, readBookFile, type BookFile } from './books/bookFiles';
import { ConvertFile } from './books/ConvertFile';

interface Props {
  api: MediaApi;
  catalogue: CatalogueApi;
  /** Where this device left each file. */
  positions: ReadingPositionStore;
  bookId: string;
  onBack: () => void;
  /** `as` reads the file converted to that format. */
  onRead: (bookId: string, mediaId: string, as?: ConversionFormat) => void;
  onEdit?: () => void;
}

/** "A", "A and B", "A, B and C", each a link to its author. */
function AuthorLinks({ authors }: { authors: ReadonlyArray<{ id: string; title?: string }> }) {
  const named = authors.filter((author) => author.title);
  return named.map((author, index) => (
    <Fragment key={author.id}>
      {index > 0 && (index === named.length - 1 ? ' and ' : ', ')}
      <Link to={routes.bookAuthor(author.id)} data-tv-focusable="true">{author.title}</Link>
    </Fragment>
  ));
}

/** What the read button says: where this device is in the file, if it has started it. */
export function readLabel(place: { progressPermille: number; finished: boolean } | undefined): string {
  if (!place) return 'Read';
  if (place.finished) return 'Read again';
  return `Continue, ${Math.floor(place.progressPermille / 10)}%`;
}

/**
 * A book: its cover, who wrote it, where it sits in each series, and its files, each read here
 * where the browser can show its format, or downloaded.
 */
export function BookScreen({ api, catalogue, positions, bookId, onBack, onRead, onEdit }: Props) {
  const details = useRefreshableAsync((signal) => api.details(bookId, signal), [api, bookId]);
  const book = details.value?.kind === 'book' ? details.value : undefined;
  const cover = useArtworkUrl(api, book?.artwork?.poster ?? book?.artwork?.thumbnail);
  const mediaIds = book?.mediaIds ?? [];
  const files = useAsync(
    (signal) => Promise.all(mediaIds.map((mediaId) => readBookFile(catalogue, mediaId, signal).catch((cause: unknown) => ({ mediaId, error: viewerErrorText(cause) })))),
    [catalogue, mediaIds.join('\n')],
  );
  const places = useSyncExternalStore(positions.subscribe, positions.getSnapshot);
  const [downloading, setDownloading] = useState<string>();
  const [error, setError] = useState<string>();

  const back = <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Books</button>;
  if (!details.value) return <section className="detail book-detail"><div className="detail-content">
    {back}
    <MediaPageTitle refreshing={details.refreshing} onRefresh={details.refresh}>Book</MediaPageTitle>
    {details.loading ? <Loading /> : details.error ? <ErrorMessage error={details.error} /> : null}
  </div></section>;
  if (!book) return <ErrorMessage error={new Error('Catalogue item is not a book.')} />;

  const context = book.bookContext;
  const download = async (file: BookFile) => {
    setDownloading(file.mediaId);
    setError(undefined);
    try {
      await downloadBookFile(catalogue, file.mediaId, book.title);
    } catch (cause) {
      setError(viewerErrorText(cause));
    } finally {
      setDownloading(undefined);
    }
  };
  const facts: Array<readonly [string, string]> = [
    ...(context?.publisher ? [['Publisher', context.publisher] as const] : []),
    ...(context?.published ? [['Published', publishedText(context.published)] as const] : []),
    ...(context?.language ? [['Language', languageName(context.language) ?? context.language] as const] : []),
    ...(context?.isbn13 ? [['ISBN', context.isbn13] as const] : []),
  ];

  return (
    <section className="detail book-detail">
      <div className="detail-content">
        {back}
        {onEdit && <EditButton onClick={onEdit} />}
        {details.error && <p className="manage-error media-refresh-error">Refresh failed: {details.error.message}</p>}
        <div className={`movie-detail-layout${cover ? ' has-poster' : ''}`}>
          <div className="movie-detail-poster" aria-hidden="true">
            {cover ? <img src={cover} alt="" /> : <div className="movie-detail-poster-placeholder">{book.title.slice(0, 1)}</div>}
          </div>
          <div className="detail-copy">
            <p className="eyebrow">Book{book.year ? ` · ${book.year}` : ''}</p>
            <MediaPageTitle refreshing={details.refreshing} onRefresh={details.refresh}>{book.title}</MediaPageTitle>
            {context && context.authors.some((author) => author.title) && <p className="subtitle book-authors">by <AuthorLinks authors={context.authors} /></p>}
            {context?.series.filter((entry) => entry.title).map((entry) => (
              <p key={entry.id} className="book-series-line">
                <Link to={routes.bookSeries(entry.id)} data-tv-focusable="true">{seriesPlaceText(entry.title as string, entry.index)}</Link>
              </p>
            ))}
            <AvailabilityNote item={book} />
            {book.synopsis && <p className="synopsis">{book.synopsis}</p>}
            {facts.length > 0 && <div className="book-facts"><Facts rows={facts} /></div>}
            <div className="book-files" aria-label="Files">
              {files.loading && mediaIds.length > 0 && <p className="list-note">Reading the files…</p>}
              {mediaIds.length === 0 && <p className="list-note">This book has no files.</p>}
              {files.value?.map((file) => 'error' in file
                ? <p key={file.mediaId} className="book-file book-file-error">A file could not be read: {file.error}</p>
                : (
                  <div key={file.mediaId} className="book-file">
                    <span className="book-file-format">{file.format ?? 'File'}</span>
                    {file.totalBytes !== undefined && <span className="book-file-size">{formatBytes(file.totalBytes)}</span>}
                    {readableHere(file) && (
                      <button className="primary-button" type="button" data-tv-focusable="true" onClick={() => onRead(book.id, file.mediaId)}>
                        {readLabel(places.find((place) => place.mediaId === file.mediaId))}
                      </button>
                    )}
                    <button className="secondary-button" type="button" data-tv-focusable="true" disabled={downloading !== undefined} onClick={() => void download(file)}>
                      {downloading === file.mediaId ? 'Downloading…' : 'Download'}
                    </button>
                    <ConvertFile catalogue={catalogue} mediaId={file.mediaId} contentType={file.contentType} title={book.title} onRead={(mediaId, as) => onRead(book.id, mediaId, as)} />
                  </div>
                ))}
              {files.value && !files.value.some((file) => !('error' in file) && readableHere(file)) && files.value.some((file) => !('error' in file)) && (
                <p className="list-note">This file cannot be shown here: convert it, or download it to read in an e-book app.</p>
              )}
              {error && <p className="manage-error" role="alert">{error}</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
