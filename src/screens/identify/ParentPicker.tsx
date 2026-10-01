import { useEffect, useState } from 'react';
import type { CatalogueItem } from '@machafoundation/core';
import { viewerErrorText } from '../../text/viewerText';

/**
 * Choose an existing catalogue item to file something under: the series an
 * episode belongs to, or an artist or album a track belongs to. Naming the
 * parent by id joins the hierarchy the scanner already built, where a name
 * alone would create a `manual:` copy beside it.
 *
 * `find` is how candidates are found: a search for the typed words, or, with
 * `browse`, every candidate at once (an artist's albums), read on mount.
 */
export function ParentPicker({ label, find, browse, chosen, onChoose, disabled }: {
  label: string;
  find: (query: string) => Promise<CatalogueItem[]>;
  browse?: boolean;
  chosen?: CatalogueItem;
  onChoose: (item: CatalogueItem | undefined) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<CatalogueItem[]>();
  const [error, setError] = useState<string>();

  const look = async (words: string) => {
    setError(undefined);
    try {
      setFound(await find(words));
    } catch (cause) {
      setError(viewerErrorText(cause));
    }
  };

  useEffect(() => {
    if (browse && !chosen) void look('');
    // Read once per picker: the parent above keys it on what it browses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (chosen) {
    return (
      <div className="identify-parent identify-parent-chosen">
        <span>{label}</span>
        <strong>{[chosen.title, chosen.year].filter(Boolean).join(' · ')}</strong>
        <button className="secondary-button" type="button" disabled={disabled} onClick={() => onChoose(undefined)} data-tv-focusable="true">Change</button>
      </div>
    );
  }

  return (
    <div className="identify-parent" role="group" aria-label={label}>
      <span>{label}</span>
      {!browse && (
        <div className="manage-search-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void look(query.trim()); } }}
            aria-label={`Search for ${label.toLowerCase()}`}
            disabled={disabled}
            data-tv-focusable="true"
          />
          <button className="secondary-button" type="button" disabled={disabled || !query.trim()} onClick={() => void look(query.trim())} data-tv-focusable="true">Find</button>
        </div>
      )}
      {error && <p className="manage-error" role="alert">{error}</p>}
      {found && (found.length === 0
        ? <p className="list-note">Nothing in the catalogue matches.</p>
        : (
          <ul className="identify-parent-options">
            {found.map((item) => (
              <li key={item.id}>
                <span>{[item.title, item.year].filter(Boolean).join(' · ')}</span>
                <button className="secondary-button" type="button" disabled={disabled} onClick={() => onChoose(item)} data-tv-focusable="true">Use</button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
