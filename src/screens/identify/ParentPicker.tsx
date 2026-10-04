import { useState } from 'react';
import type { CatalogueItem } from '@machafoundation/core';
import { viewerErrorText } from '../../text/viewerText';

/**
 * Chooses an existing catalogue item as a parent: an episode's series, or a
 * track's artist or album. Naming the parent by id joins the scanner's
 * hierarchy; a name alone would create a `manual:` copy beside it.
 */
export function ParentPicker({ label, find, chosen, onChoose, disabled }: {
  label: string;
  find: (query: string) => Promise<CatalogueItem[]>;
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
