/**
 * The policy put on the page before any book is shown. An e-book can carry scripts, and the
 * reader shows each section in a same-origin frame, where a script could read the session.
 * A frame made from a `blob:` URL takes the policy of the page that made it, so allowing only
 * this app's own scripts stops a book's from running. Workers keep `blob:`, which playback's
 * stream parser starts from.
 *
 * Added when the reader first opens, not at boot: the built page's own inline loader has run
 * by then. A policy cannot be lifted, so it stays until the page reloads, and nothing in the
 * app needs more than it allows.
 */
export const READER_SCRIPT_POLICY = "script-src 'self'; worker-src 'self' blob:; object-src 'none'";

const MARK = 'data-macha-reader-policy';

/** Puts the policy on the page, once. */
export function lockBookScripts(doc: Document = document): void {
  if (doc.head.querySelector(`meta[${MARK}]`)) return;
  const meta = doc.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = READER_SCRIPT_POLICY;
  meta.setAttribute(MARK, '');
  doc.head.prepend(meta);
}
