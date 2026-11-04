import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CatalogueApi, CatalogueContent, ConversionFormat, MediaApi, ReadingPositionStore } from '@machafoundation/core';
import { ErrorMessage, Loading } from '../components/Status';
import { useAsync } from '../hooks/useAsync';
import { bookFormatName } from '../text/viewerText';
import { BookReader, bookFileFor, type ReaderPlace } from './books/BookReader';
import { readableHere } from './books/bookFiles';

interface Props {
  api: MediaApi;
  catalogue: CatalogueApi;
  positions: ReadingPositionStore;
  bookId: string;
  mediaId: string;
  /** Read the file converted to this format, on whichever node holds the conversion. */
  as?: ConversionFormat;
  onBack: () => void;
}

/**
 * Where a place is kept: the file's media id, or for a converted copy the id and the format, since a
 * place in one format means nothing in another. A converted copy's key is this client's, not a
 * `macha:` id, so it stays on the device when places move to the server.
 */
export function positionKey(mediaId: string, as?: ConversionFormat): string {
  return as ? `${mediaId}#${as}` : mediaId;
}

/** Past this, a book counts as read. */
const FINISHED_FRACTION = 0.995;

/**
 * One of a book's files, read here. A PDF shows in the browser's own viewer, which keeps no place;
 * every other format the reader takes opens in pages, at the place last left on this device.
 * The file is fetched through core because its URL needs the session's token.
 */
export function ReaderScreen({ api, catalogue, positions, bookId, mediaId, as, onBack }: Props) {
  const book = useAsync((signal) => api.details(bookId, signal), [api, bookId]);
  const content = useAsync(
    (signal): Promise<Pick<CatalogueContent, 'body' | 'contentType'>> => (as ? catalogue.conversionContent({ mediaId, format: as }, { signal }) : catalogue.content(mediaId, { signal })),
    [catalogue, mediaId, as],
  );
  const key = positionKey(mediaId, as);
  const format = bookFormatName(content.value?.contentType);
  const [pdfUrl, setPdfUrl] = useState<string>();
  const [readError, setReadError] = useState<Error>();
  // Read once per file: the reader moves itself on from there.
  const start = useMemo(() => positions.get(key)?.position, [positions, key]);
  const file = useMemo(
    () => (content.value && format !== 'PDF' ? bookFileFor(content.value.body, content.value.contentType, format) : undefined),
    [content.value, format],
  );

  useEffect(() => {
    if (!content.value || format !== 'PDF') return undefined;
    // Typed by the server's answer, so the browser opens its PDF viewer whatever type the body carried.
    const objectUrl = URL.createObjectURL(new Blob([content.value.body], { type: 'application/pdf' }));
    setPdfUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setPdfUrl(undefined);
    };
  }, [content.value, format]);

  const keep = useCallback((place: ReaderPlace) => {
    positions.set({
      mediaId: key,
      itemId: bookId,
      position: place.position,
      progressPermille: place.fraction * 1000,
      finished: place.fraction >= FINISHED_FRACTION,
    });
  }, [bookId, key, positions]);

  const title = book.value?.title ?? 'Book';
  const readable = format !== undefined && readableHere({ format });
  return (
    <section className="reader-screen">
      <div className="reader-toolbar">
        <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← {title}</button>
      </div>
      {content.loading && <Loading />}
      {content.error && <ErrorMessage error={content.error} />}
      {readError && <ErrorMessage error={readError} />}
      {content.value && !readable && <p className="list-note">This file cannot be shown here: download it from the book's page to read it in an e-book app.</p>}
      {pdfUrl && <iframe className="reader-frame" src={pdfUrl} title={title} />}
      {file && readable && !readError && <BookReader file={file} start={start} onPlace={keep} onError={setReadError} />}
    </section>
  );
}
