// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { BookContext, BookSeriesDetails, CatalogueApi, MediaApi, MediaSummary } from '@machafoundation/core';
import { BookScreen } from '../BookScreen';
import { BookCollectionScreen } from '../BookCollectionScreen';
import { BooksScreen } from '../BooksScreen';
import { SearchScreen } from '../SearchScreen';
import { MediaCard } from '../../components/MediaCard';
import { settle } from '../../test/settle';
import { availabilityText, bookAuthorsText, bookFormatName, cardSubtitle, seriesPlaceText } from '../../text/viewerText';
import { downloadName, readableHere } from './bookFiles';

const context = (overrides: Partial<BookContext> = {}): BookContext => ({
  authors: [{ id: 'author:one', title: 'One Author' }],
  series: [{ id: 'series:a', title: 'A Series', index: 2 }],
  ...overrides,
});

const book = (id: string, title: string, overrides: Partial<MediaSummary> = {}): MediaSummary => ({
  id, kind: 'book', title, mediaIds: [], bookContext: context(), ...overrides,
} as MediaSummary);

function mediaApi(overrides: Partial<MediaApi> = {}): MediaApi {
  return {
    books: vi.fn(async () => []),
    authors: vi.fn(async () => []),
    bookSeries: vi.fn(async () => []),
    search: vi.fn(async () => []),
    artwork: vi.fn(),
    ...overrides,
  } as unknown as MediaApi;
}

/** A catalogue whose files answer with these types and sizes, by media id. */
function catalogueOf(files: Record<string, { type: string; size: number } | Error>): CatalogueApi {
  return {
    content: vi.fn(async (mediaId: string) => {
      const file = files[mediaId];
      if (file instanceof Error) throw file;
      return { mediaId, body: new Blob(['x']), contentType: file.type, totalBytes: file.size };
    }),
  } as unknown as CatalogueApi;
}

describe('book wording', () => {
  it('names authors in credited order and a place in a series, a novella\'s included', () => {
    expect(bookAuthorsText({ bookContext: context({ authors: [{ id: 'a', title: 'A' }, { id: 'b' }, { id: 'c', title: 'C' }, { id: 'd', title: 'D' }] }) })).toBe('A, C and D');
    expect(bookAuthorsText({ bookContext: context({ authors: [] }) })).toBeUndefined();
    expect(seriesPlaceText('A Series', 8.5)).toBe('A Series, book 8.5');
    expect(seriesPlaceText('A Series', null)).toBe('A Series');
    expect(cardSubtitle(book('b1', 'A Novel'))).toBe('One Author');
  });

  it('names the formats the server types, and opens only a PDF here', () => {
    expect(bookFormatName('application/epub+zip')).toBe('EPUB');
    expect(bookFormatName('application/pdf; charset=binary')).toBe('PDF');
    expect(bookFormatName('application/octet-stream')).toBeUndefined();
    expect(readableHere({ format: 'PDF' })).toBe(true);
    expect(readableHere({ format: 'EPUB' })).toBe(false);
  });

  it('saves a file under its title, without characters a file system refuses', () => {
    expect(downloadName('A Novel: Part 1/2?', 'EPUB')).toBe('A Novel Part 12.epub');
    expect(downloadName('***', undefined)).toBe('book');
  });

  it('says a book cannot be opened, not played', () => {
    expect(availabilityText('unavailable', 'book')).toBe('This book is held only by servers that can\'t be reached right now, so it can\'t be opened.');
    expect(availabilityText('unavailable', 'author')).toMatch(/^Every book by this author/);
  });
});

describe('a book\'s page', () => {
  function showBook(item: MediaSummary, files: Parameters<typeof catalogueOf>[0]) {
    const api = mediaApi({ details: vi.fn(async () => item) });
    const catalogue = catalogueOf(files);
    const onRead = vi.fn();
    render(<MemoryRouter><BookScreen api={api} catalogue={catalogue} bookId={item.id} onBack={vi.fn()} onRead={onRead} /></MemoryRouter>);
    return { catalogue, onRead };
  }

  it('names its authors and its place in each series, as links', async () => {
    showBook(book('b1', 'A Novel', { bookContext: context({ authors: [{ id: 'author:one', title: 'One Author' }, { id: 'author:two', title: 'Two Author' }] }) }), {});
    await settle();
    expect(screen.getByText(/^by/).textContent).toBe('by One Author and Two Author');
    expect(screen.getByRole('link', { name: 'Two Author' }).getAttribute('href')).toBe('/books/authors/author%3Atwo');
    expect(screen.getByRole('link', { name: 'A Series, book 2' }).getAttribute('href')).toBe('/books/series/series%3Aa');
  });

  it('lists each file by format and size from its first byte, reading a PDF here and offering every one for download', async () => {
    const { catalogue, onRead } = showBook(book('b1', 'A Novel', { mediaIds: ['macha:epub', 'macha:pdf'] }), {
      'macha:epub': { type: 'application/epub+zip', size: 2048 },
      'macha:pdf': { type: 'application/pdf', size: 4096 },
    });
    await settle();
    expect(catalogue.content).toHaveBeenCalledWith('macha:epub', expect.objectContaining({ range: { start: 0, end: 0 } }));
    const files = within(screen.getByLabelText('Files'));
    const rows = files.getAllByRole('button', { name: 'Download' }).map((button) => button.closest('.book-file')?.textContent);
    expect(rows).toEqual(['EPUB2.00 KBDownload', 'PDF4.00 KBReadDownload']);
    fireEvent.click(files.getByRole('button', { name: 'Read' }));
    expect(onRead).toHaveBeenCalledWith('b1', 'macha:pdf');
  });

  it('says when no file can be shown here, and which file could not be read', async () => {
    showBook(book('b1', 'A Novel', { mediaIds: ['macha:epub', 'macha:gone'] }), {
      'macha:epub': { type: 'application/epub+zip', size: 2048 },
      'macha:gone': new Error('No node can read this file.'),
    });
    await settle();
    expect(screen.getByText(/cannot show these formats yet/)).toBeTruthy();
    expect(screen.getByText(/A file could not be read/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Read' })).toBeNull();
  });
});

describe('a series\' page', () => {
  it('shows its books in core\'s order, each with its place and its author', async () => {
    const series = {
      id: 'series:a', kind: 'series', title: 'A Series', mediaIds: [],
      books: [
        book('b1', 'First', { bookContext: context({ series: [{ id: 'series:a', title: 'A Series', index: 1 }] }) }),
        book('b2', 'Unnumbered', { bookContext: context({ series: [{ id: 'series:a', title: 'A Series', index: null }] }) }),
      ],
    } as unknown as BookSeriesDetails;
    render(<MemoryRouter><BookCollectionScreen api={mediaApi({ details: vi.fn(async () => series) })} kind="series" id="series:a" onBack={vi.fn()} onOpenBook={vi.fn()} /></MemoryRouter>);
    await settle();
    expect([...document.querySelectorAll('.media-card')].map((card) => card.textContent)).toEqual(['FFirstBook 1 · One Author', 'UUnnumberedOne Author']);
  });
});

describe('the Books lists', () => {
  it('says how books arrive when there are none', async () => {
    render(<MemoryRouter><BooksScreen api={mediaApi()} section="titles" onOpen={vi.fn()} /></MemoryRouter>);
    await settle();
    expect(screen.getByText(/No books yet/)).toBeTruthy();
  });

  it('asks for authors and series from their own lists', async () => {
    const api = mediaApi({ authors: vi.fn(async () => [{ id: 'author:one', kind: 'author', title: 'One Author', mediaIds: [] } as MediaSummary]) });
    render(<MemoryRouter><BooksScreen api={api} section="authors" onOpen={vi.fn()} /></MemoryRouter>);
    await settle();
    expect(api.authors).toHaveBeenCalled();
    expect(api.books).not.toHaveBeenCalled();
    expect(screen.getByText('One Author')).toBeTruthy();
  });
});

describe('a book found in search', () => {
  it('links its author and its series, and opens rather than plays', () => {
    render(<MemoryRouter><MediaCard api={mediaApi()} item={book('b1', 'A Novel')} onOpen={vi.fn()} variant="in-context" /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Open A Novel' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'One Author' }).getAttribute('href')).toBe('/books/authors/author%3Aone');
    expect(screen.getByRole('link', { name: 'A Series, book 2' })).toBeTruthy();
  });

  it('is searched for only by a client that can open books', async () => {
    const withBooks = mediaApi();
    const { unmount } = render(<MemoryRouter><SearchScreen api={withBooks} onOpen={vi.fn()} books /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('Search your library'), { target: { value: 'novel' } });
    // The search waits for typing to pause.
    await waitFor(() => expect(withBooks.search).toHaveBeenCalledWith('novel', undefined, { categories: ['movies', 'shows', 'music', 'books'] }));
    expect(screen.getByRole('button', { name: 'Books' })).toBeTruthy();
    unmount();

    const without = mediaApi();
    render(<MemoryRouter><SearchScreen api={without} onOpen={vi.fn()} /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('Search your library'), { target: { value: 'novel' } });
    await waitFor(() => expect(without.search).toHaveBeenCalledWith('novel', undefined, { categories: ['movies', 'shows', 'music'] }));
    expect(screen.queryByRole('button', { name: 'Books' })).toBeNull();
  });
});
