import type { CatalogueApi } from '@machafoundation/core';
import { bookFormatName } from '../../text/viewerText';

/** One of a book's files: an EPUB and a PDF of one edition are one book with two. */
export interface BookFile {
  mediaId: string;
  contentType: string;
  /** "EPUB", "PDF"; undefined for a type with no name here. */
  format?: string;
  totalBytes?: number;
}

/**
 * A file's format and size, from its first byte: the server names the type from the file and
 * states the whole size in `Content-Range`, so nothing more is read.
 */
export async function readBookFile(catalogue: Pick<CatalogueApi, 'content'>, mediaId: string, signal?: AbortSignal): Promise<BookFile> {
  const read = await catalogue.content(mediaId, { range: { start: 0, end: 0 }, signal });
  return { mediaId, contentType: read.contentType, format: bookFormatName(read.contentType), totalBytes: read.totalBytes };
}

/** The formats the reader opens: a PDF in the browser's own viewer, the rest in pages with foliate-js. */
const READABLE: ReadonlySet<string> = new Set(['EPUB', 'MOBI', 'AZW3', 'FB2', 'CBZ', 'PDF']);

/** Whether this client can show the format itself. */
export function readableHere(file: Pick<BookFile, 'format'>): boolean {
  return file.format !== undefined && READABLE.has(file.format);
}

/** A file name for a download: the title, without characters a file system refuses, and the format's extension. */
export function downloadName(title: string, format: string | undefined): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim() || 'book';
  return format ? `${base}.${format.toLowerCase()}` : base;
}

/**
 * Saves a file to the device. Fetched through core, since every content URL needs the session's
 * token and a plain link cannot send it.
 */
export async function downloadBookFile(catalogue: Pick<CatalogueApi, 'content'>, mediaId: string, title: string): Promise<void> {
  const read = await catalogue.content(mediaId);
  saveBlob(read.body, title, bookFormatName(read.contentType));
}

/** Hands bytes already fetched to the browser as a download named for the book. */
export function saveBlob(body: Blob, title: string, format: string | undefined): void {
  const url = URL.createObjectURL(body);
  const link = document.createElement('a');
  link.href = url;
  link.download = downloadName(title, format);
  document.body.append(link);
  link.click();
  link.remove();
  // The browser has taken the bytes once the click returns; the delay covers a slow save dialog.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A language code as a name: "en" reads "English". The code itself where the browser has no name for it. */
export function languageName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
