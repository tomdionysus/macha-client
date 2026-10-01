import { useMemo, useState } from 'react';
import type { ManageApi, MediaProbeCandidate, ProviderSearchKind, ProviderSearchResult, UnmatchedDetail } from '@machafoundation/core';
import { viewerErrorText } from '../../text/viewerText';
import { NumberField, numberText, TextField, wholeNumber } from './fields';
import { groupRecords, sameTitle } from './providerLookup';
import { ProviderRecord, type RecordNumbers } from './ProviderRecord';

const KIND_LABEL: Record<ProviderSearchKind, string> = { movie: 'Movie', show: 'TV series', album: 'Music album' };

/** What a file most likely is: what its candidate says, else the library it came in through. */
export function likelyKind(detail: UnmatchedDetail, probe?: MediaProbeCandidate): MediaProbeCandidate['kind'] {
  return probe?.kind ?? (detail.item.provider === 'tv' ? 'episode' : detail.item.provider === 'music' ? 'track' : 'movie');
}

/** The provider record a file of that kind is found under: an episode's series, a track's album. */
function providerKindFor(detail: UnmatchedDetail, probe?: MediaProbeCandidate): ProviderSearchKind {
  const kind = likelyKind(detail, probe);
  return kind === 'episode' ? 'show' : kind === 'track' ? 'album' : 'movie';
}

/** The words to search the provider with first: the candidate's name for the thing a provider lists. */
function initialQuery(kind: ProviderSearchKind, probe?: MediaProbeCandidate): string {
  if (!probe) return '';
  if (kind === 'show') return probe.series || probe.title;
  if (kind === 'album') return probe.album || probe.title;
  return probe.title;
}

/** The numbers a candidate states, to seed each record's. */
export function candidateNumbers(probe?: MediaProbeCandidate): RecordNumbers {
  return {
    season: probe?.season_number ?? undefined,
    episode: probe?.episode_number ?? undefined,
    disc: probe?.disc_number ?? undefined,
    track: probe?.track_number ?? undefined,
  };
}

/**
 * Search TMDB or MusicBrainz with any words, when the suggestions are not
 * it. Each result is a record to use, as a suggestion is.
 */
export function ProviderMatch({ detail, probe, manage, onResolved }: {
  detail: UnmatchedDetail;
  probe?: MediaProbeCandidate;
  manage: ManageApi;
  onResolved: () => void;
}) {
  const [kind, setKind] = useState<ProviderSearchKind>(() => providerKindFor(detail, probe));
  const [query, setQuery] = useState(() => initialQuery(kind, probe));
  const [year, setYear] = useState(() => numberText(kind === 'movie' ? probe?.year : undefined));
  const [artist, setArtist] = useState(probe?.artist ?? '');
  const [results, setResults] = useState<ProviderSearchResult[]>();
  const [busy, setBusy] = useState(false);
  const grouped = useMemo(() => results && groupRecords(results), [results]);
  const [error, setError] = useState<string>();

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const found = await manage.providerSearch(query.trim(), kind, { year: wholeNumber(year), limit: 20 });
      // The artist narrows here, loosely: the provider's own filter is exact
      // and finds nothing for "DJ Someone" where it credits "Someone".
      const by = kind === 'album' ? artist.trim() : '';
      setResults(by ? found.filter((result) => !result.artist || sameTitle(by, result.artist)) : found);
    } catch (cause) {
      setError(viewerErrorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="identify-provider">
      <form className="manage-manual-form" aria-label="Search TMDB and MusicBrainz" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <label>Type
          <select value={kind} onChange={(event) => { setKind(event.target.value as ProviderSearchKind); setResults(undefined); }} disabled={busy} data-tv-focusable="true">
            {(Object.keys(KIND_LABEL) as ProviderSearchKind[]).map((key) => <option key={key} value={key}>{KIND_LABEL[key]}</option>)}
          </select>
        </label>
        <TextField label="Search for" value={query} onChange={setQuery} disabled={busy} />
        <div className="manage-field-row">
          <NumberField label="Year" value={year} onChange={setYear} disabled={busy} />
          {kind === 'album' && <TextField label="Artist" value={artist} onChange={setArtist} disabled={busy} />}
        </div>
        <button className="secondary-button" type="submit" disabled={busy || !query.trim()} data-tv-focusable="true">Search</button>
      </form>

      {error && <p className="manage-error" role="alert">{error}</p>}
      {results && (results.length === 0
        ? <p className="list-note">Nothing found for that search.</p>
        : (
          <ul className="identify-matches">
            {grouped?.map((releases) => (
              <ProviderRecord key={releases[0].ref} releases={releases} file={detail.item} manage={manage} numbers={candidateNumbers(probe)} disabled={busy} onResolved={onResolved} />
            ))}
          </ul>
        ))}
    </div>
  );
}
