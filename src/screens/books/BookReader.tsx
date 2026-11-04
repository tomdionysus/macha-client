import { useEffect, useRef, useState } from 'react';
import type { FoliateLocation, FoliateView } from 'foliate-js/view.js';
import { lockBookScripts } from './readerSecurity';

/** Where the reader is, as it reports each turn of the page. */
export interface ReaderPlace {
  /** An EPUB CFI, which foliate-js gives for every format it reads. */
  position: string;
  /** 0 to 1 through the whole book. */
  fraction: number;
  chapter?: string;
}

/** Light text on the page's own dark ground, at a measure that reads well. */
const BOOK_STYLES = `
  html { color-scheme: dark; }
  body { color: #dedee2 !important; background: transparent !important; line-height: 1.6; }
  a:any-link { color: #f0a7ae !important; }
`;

/** A book file `foliate-js` reads: the name's extension is how it tells some formats apart. */
export function bookFileFor(body: Blob, contentType: string, format: string | undefined): File {
  return new File([body], `book.${(format ?? 'bin').toLowerCase()}`, { type: contentType });
}

/**
 * An e-book in pages: EPUB, MOBI, AZW3, FB2 or CBZ. Opens at `start` when it is given, and
 * reports every move. Arrow keys and the side buttons turn the page.
 */
export function BookReader({ file, start, onPlace, onError }: {
  file: File;
  start?: string;
  onPlace: (place: ReaderPlace) => void;
  onError: (error: Error) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<FoliateView | undefined>(undefined);
  const [place, setPlace] = useState<ReaderPlace>();
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    let opened: FoliateView | undefined;
    // Before the library loads or any book is opened, so no section of it can run a script.
    lockBookScripts();
    void (async () => {
      try {
        await import('foliate-js/view.js');
        if (cancelled || !host.current) return;
        opened = document.createElement('foliate-view') as FoliateView;
        opened.className = 'book-reader-view';
        opened.addEventListener('relocate', (event) => {
          const detail = (event as CustomEvent<FoliateLocation>).detail;
          const next = { position: detail.cfi, fraction: detail.fraction ?? 0, chapter: detail.tocItem?.label };
          setPlace(next);
          onPlaceRef.current(next);
        });
        host.current.append(opened);
        await opened.open(file);
        if (cancelled) return;
        opened.renderer.setAttribute('flow', 'paginated');
        opened.renderer.setAttribute('max-inline-size', '720px');
        opened.renderer.setAttribute('gap', '6%');
        opened.renderer.setStyles?.(BOOK_STYLES);
        view.current = opened;
        await opened.init({ lastLocation: start, showTextStart: !start });
      } catch (cause) {
        if (!cancelled) onErrorRef.current(cause instanceof Error ? cause : new Error(String(cause)));
      }
    })();
    return () => {
      cancelled = true;
      view.current = undefined;
      opened?.close();
      opened?.remove();
    };
    // The start place is read once, at open; later places come from the reader itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') void view.current?.goLeft();
      else if (event.key === 'ArrowRight') void view.current?.goRight();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="book-reader">
      <button className="book-reader-turn" type="button" aria-label="Previous page" onClick={() => void view.current?.goLeft()}>‹</button>
      <div className="book-reader-page" ref={host} />
      <button className="book-reader-turn" type="button" aria-label="Next page" onClick={() => void view.current?.goRight()}>›</button>
      <p className="book-reader-progress" aria-live="polite">
        {place ? [place.chapter, `${Math.round(place.fraction * 100)}%`].filter(Boolean).join(' · ') : ''}
      </p>
    </div>
  );
}
