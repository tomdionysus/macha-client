import type { ReactNode } from 'react';

/**
 * The shared parts of a job or file list and an item's own page, for Import
 * and Manage alike. Styles in `styles/lists.css`.
 */

/** A list's heading: its name and count, with its controls (sort, bulk actions) to the right. */
export function ListHeading({ id, title, count, children }: { id: string; title: string; count: number; children?: ReactNode }) {
  return (
    <div className="list-heading">
      <h2 id={id}>{title} <span>{count}</span></h2>
      {children}
    </div>
  );
}

/** An item page's header: its state or kind above the title, and its actions to the right. */
export function DetailHeader({ kicker, kickerClass = '', title, actions }: { kicker: string; kickerClass?: string; title: string; actions?: ReactNode }) {
  return (
    <header className="detail-header">
      <div>
        <span className={`detail-kicker${kickerClass ? ` ${kickerClass}` : ''}`}>{kicker}</span>
        <h1>{title}</h1>
      </div>
      {actions}
    </header>
  );
}

/** Label and value pairs, labels left and values right. */
export function Facts({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return <dl className="facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

/** A quiet card with a small-capitals heading, for an item's facts. */
export function DetailCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="detail-card" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

/** Previous and next through a long list, with where the page sits in it. Nothing for a list of one page. */
export function Pager({ label, page, pageCount, first, last, total, onPage }: {
  label: string;
  page: number;
  pageCount: number;
  first: number;
  last: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="pager" aria-label={label}>
      <button className="secondary-button" type="button" disabled={page === 0} onClick={() => onPage(page - 1)} data-tv-focusable="true">Previous</button>
      <span>{first}–{last} of {total} · page {page + 1} of {pageCount}</span>
      <button className="secondary-button" type="button" disabled={page + 1 >= pageCount} onClick={() => onPage(page + 1)} data-tv-focusable="true">Next</button>
    </nav>
  );
}
