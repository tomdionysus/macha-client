import { useEffect, useState, type ReactNode } from 'react';

/** Shared parts of list and item pages, for Import and Manage. Styles in `styles/lists.css`. */

/** Omit `count` where there is no list to count, rather than showing a false 0. */
export function ListHeading({ id, title, count, children }: { id: string; title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="list-heading">
      <h2 id={id}>{title}{count !== undefined && <> <span>{count}</span></>}</h2>
      {children}
    </div>
  );
}

/** `kicker` is the item's state or kind, shown above the title. */
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

export function Facts({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return <dl className="facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function DetailCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="detail-card" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

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

/** Runs every operation at once; resolves to how many failed. */
export async function runBulkOperation(ids: readonly string[], operation: (id: string) => Promise<void>): Promise<number> {
  const results = await Promise.allSettled(ids.map(operation));
  return results.filter((result) => result.status === 'rejected').length;
}

/**
 * The ticked rows, kept across pages. A row that leaves the list leaves the selection, so a bulk
 * action never reaches a row the viewer cannot see.
 */
export function useListSelection(items: ReadonlyArray<{ id: string }>) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    setChecked((current) => {
      const present = new Set(items.map((item) => item.id));
      const kept = [...current].filter((id) => present.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [items]);

  const setMany = (ids: readonly string[], on: boolean) => setChecked((current) => {
    const next = new Set(current);
    for (const id of ids) {
      if (on) next.add(id); else next.delete(id);
    }
    return next;
  });

  return { checked, setMany, clear: () => setChecked(new Set()) };
}

export type ListSelection = ReturnType<typeof useListSelection>;

/** Ticks or unticks the visible page only; selections on other pages stay. */
export function SelectPageBox({ ids, selection, disabled }: { ids: readonly string[]; selection: ListSelection; disabled?: boolean }) {
  const all = ids.length > 0 && ids.every((id) => selection.checked.has(id));
  const some = !all && ids.some((id) => selection.checked.has(id));
  return (
    <input
      type="checkbox"
      aria-label="Select this page"
      data-tv-focusable="true"
      checked={all}
      ref={(element) => { if (element) element.indeterminate = some; }}
      onChange={(event) => selection.setMany(ids, event.target.checked)}
      disabled={disabled}
    />
  );
}

export function SelectRowBox({ id, name, selection, disabled }: { id: string; name: string; selection: ListSelection; disabled?: boolean }) {
  return (
    <input
      type="checkbox"
      checked={selection.checked.has(id)}
      onChange={(event) => selection.setMany([id], event.target.checked)}
      aria-label={`Select ${name}`}
      data-tv-focusable="true"
      disabled={disabled}
    />
  );
}

export function BulkActions({ label, selection, disabled, children }: { label: string; selection: ListSelection; disabled?: boolean; children: ReactNode }) {
  if (selection.checked.size === 0) return null;
  return (
    <div className="list-bulk-actions" role="group" aria-label={label}>
      <span>{selection.checked.size} selected</span>
      {children}
      <button className="secondary-button" type="button" disabled={disabled} onClick={selection.clear} data-tv-focusable="true">Clear</button>
    </div>
  );
}
