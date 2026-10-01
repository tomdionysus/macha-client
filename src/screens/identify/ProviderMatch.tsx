import { useState } from 'react';
import {
  identifyUnmatched,
  type ManageApi,
  type MediaProbeCandidate,
  type ProviderMatchRef,
  type ProviderSearchKind,
  type ProviderSearchResult,
  type UnmatchedDetail,
} from '@machafoundation/core';
import { viewerErrorText } from '../../text/viewerText';
import { NumberField, numberText, TextField, wholeNumber } from './fields';

const KIND_LABEL: Record<ProviderSearchKind, string> = { movie: 'Movie', show: 'TV series', album: 'Music album' };
const PROVIDER_LABEL: Record<string, string> = { tmdb: 'TMDB', musicbrainz: 'MusicBrainz' };

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

/**
 * What to send to match a file to a provider result, or a sentence for what
 * is missing: a series needs the season and episode that are this file, and
 * an album the track that is (and, on a set, the disc).
 */
export function providerMatchTarget(
  result: Pick<ProviderSearchResult, 'ref' | 'kind'>,
  numbers: { season?: number; episode?: number; disc?: number; track?: number },
): ProviderMatchRef | string {
  if (result.kind === 'show') {
    if (numbers.season == null || numbers.episode == null) return 'Enter the season and episode this file is.';
    return { ref: result.ref, season_number: numbers.season, episode_number: numbers.episode };
  }
  if (result.kind === 'album') {
    if (numbers.track == null) return 'Enter the track number this file is.';
    return { ref: result.ref, track_number: numbers.track, ...(numbers.disc != null ? { disc_number: numbers.disc } : {}) };
  }
  return { ref: result.ref };
}

/**
 * Search the metadata provider with any words, and match the file to a
 * result. The server fetches the record, builds its hierarchy (reusing what
 * the catalogue already holds), stages its artwork and binds the file, as a
 * scan match does; applied through core's `identifyUnmatched`.
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
  const [season, setSeason] = useState(numberText(probe?.season_number));
  const [episode, setEpisode] = useState(numberText(probe?.episode_number));
  const [disc, setDisc] = useState(numberText(probe?.disc_number));
  const [track, setTrack] = useState(numberText(probe?.track_number));
  const [results, setResults] = useState<ProviderSearchResult[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      setResults(await manage.providerSearch(query.trim(), kind, {
        year: wholeNumber(year),
        artist: kind === 'album' ? artist.trim() || undefined : undefined,
      }));
    } catch (cause) {
      setError(viewerErrorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const match = async (result: ProviderSearchResult) => {
    const target = providerMatchTarget(result, {
      season: wholeNumber(season), episode: wholeNumber(episode), disc: wholeNumber(disc), track: wholeNumber(track),
    });
    if (typeof target === 'string') {
      setError(target);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await identifyUnmatched(manage, detail.item.id, { from: 'provider', target });
      onResolved();
    } catch (cause) {
      setError(viewerErrorText(cause));
      setBusy(false);
    }
  };

  return (
    <div className="identify-provider">
      <form className="manage-manual-form" aria-label="Search the metadata provider" onSubmit={(event) => { event.preventDefault(); void search(); }}>
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
        {/* The numbers that pick this file out of a series or an album, asked once for whichever result is matched. */}
        {kind === 'show' && (
          <div className="manage-field-row">
            <NumberField label="Season" value={season} onChange={setSeason} disabled={busy} />
            <NumberField label="Episode" value={episode} onChange={setEpisode} disabled={busy} />
          </div>
        )}
        {kind === 'album' && (
          <div className="manage-field-row">
            <NumberField label="Disc" value={disc} onChange={setDisc} disabled={busy} />
            <NumberField label="Track" value={track} onChange={setTrack} disabled={busy} />
          </div>
        )}
        <button className="secondary-button" type="submit" disabled={busy || !query.trim()} data-tv-focusable="true">Search</button>
      </form>

      {error && <p className="manage-error" role="alert">{error}</p>}
      {results && (results.length === 0
        ? <p className="list-note">The provider found nothing for that search.</p>
        : (
          <ul className="identify-matches">
            {results.map((result) => (
              <li key={result.ref}>
                <div>
                  <strong>{[result.title, result.year].filter(Boolean).join(' · ')}</strong>
                  <span>{[result.artist, PROVIDER_LABEL[result.provider] ?? result.provider, result.catalogue_item_id ? 'already in the catalogue' : undefined].filter(Boolean).join(' · ')}</span>
                  {result.overview && <p className="identify-overview">{result.overview}</p>}
                </div>
                <button className="secondary-button" type="button" disabled={busy} onClick={() => void match(result)} data-tv-focusable="true">Match</button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
