import { useEffect, useState } from 'react';
import type { CatalogueApi, MediaApi } from '@machafoundation/core';
import { ErrorMessage, Loading } from '../components/Status';
import { useAsync } from '../hooks/useAsync';
import { bookFormatName } from '../text/viewerText';

interface Props {
  api: MediaApi;
  catalogue: CatalogueApi;
  bookId: string;
  mediaId: string;
  onBack: () => void;
}

/**
 * A book file shown in the browser's own viewer. Only a PDF comes here: the browser shows one
 * itself, and the file is fetched through core because its URL needs the session's token.
 */
export function ReaderScreen({ api, catalogue, bookId, mediaId, onBack }: Props) {
  const book = useAsync((signal) => api.details(bookId, signal), [api, bookId]);
  const content = useAsync((signal) => catalogue.content(mediaId, { signal }), [catalogue, mediaId]);
  const [url, setUrl] = useState<string>();
  const format = bookFormatName(content.value?.contentType);

  useEffect(() => {
    if (!content.value || format !== 'PDF') return undefined;
    // Typed by the server's answer, so the browser opens its PDF viewer whatever type the body carried.
    const objectUrl = URL.createObjectURL(new Blob([content.value.body], { type: 'application/pdf' }));
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(undefined);
    };
  }, [content.value, format]);

  const title = book.value?.title ?? 'Book';
  return (
    <section className="reader-screen">
      <div className="reader-toolbar">
        <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← {book.value?.title ?? 'Book'}</button>
      </div>
      {content.loading && <Loading />}
      {content.error && <ErrorMessage error={content.error} />}
      {content.value && format !== 'PDF' && <p className="list-note">This browser cannot show {format ?? 'this file'} here yet: download it from the book's page to read it in an e-book app.</p>}
      {url && <iframe className="reader-frame" src={url} title={title} />}
    </section>
  );
}
