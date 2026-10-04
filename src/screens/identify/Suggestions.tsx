import { useEffect, useState } from 'react';
import type { ManageApi, UnmatchedDetail } from '@machafoundation/core';
import { findSuggestions, type Suggestion } from './providerLookup';
import { ProviderRecord } from './ProviderRecord';

/** Where identifying a file starts: the provider records it most likely is, found from what the file says about itself. */
export function Suggestions({ detail, manage, onResolved }: {
  detail: UnmatchedDetail;
  manage: ManageApi;
  onResolved: () => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>();

  useEffect(() => {
    let cancelled = false;
    setSuggestions(undefined);
    void findSuggestions(manage, detail.probes).then((found) => { if (!cancelled) setSuggestions(found); });
    return () => { cancelled = true; };
  }, [manage, detail]);

  return (
    <section className="detail-card identify-panel" aria-labelledby="suggestions-heading">
      <h2 id="suggestions-heading">Suggestions</h2>
      {suggestions === undefined && <p className="ingest-loading">Looking this file up on TMDB and MusicBrainz…</p>}
      {suggestions?.length === 0 && <p className="list-note">Nothing on TMDB or MusicBrainz matches what this file says. Search for it below.</p>}
      {suggestions && suggestions.length > 0 && (
        <ul className="identify-matches">
          {suggestions.map(({ releases, lookup }) => (
            <ProviderRecord
              key={releases[0].ref}
              releases={releases}
              file={detail.item}
              manage={manage}
              numbers={{ season: lookup.season_number, episode: lookup.episode_number, disc: lookup.disc_number, track: lookup.track_number }}
              onResolved={onResolved}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
