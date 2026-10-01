import { useState } from 'react';
import {
  identifyUnmatched,
  type ManageApi,
  type ManualMetadataResult,
  type MediaProbeCandidate,
  type ProviderArtworkOption,
  type ProviderArtworkRole,
  type ProviderMatchRef,
  type ProviderSearchKind,
  type ProviderSearchResult,
  type UnmatchedDetail,
} from '@machafoundation/core';
import { viewerErrorText } from '../../text/viewerText';
import { NumberField, numberText, TextField, wholeNumber } from './fields';

const KIND_LABEL: Record<ProviderSearchKind, string> = { movie: 'Movie', show: 'TV series', album: 'Music album' };
const PROVIDER_LABEL: Record<string, string> = { tmdb: 'TMDB', musicbrainz: 'MusicBrainz' };

/**
 * The picture a match is chosen with, by what it matches: a movie's poster,
 * the episode's still (a series result names the episode by its numbers), an
 * album's cover. The cover goes on the album the match writes, the others on
 * the file's own item.
 */
const ARTWORK_ROLE: Record<ProviderSearchResult['kind'], ProviderArtworkRole> = { movie: 'poster', show: 'still', album: 'cover' };

/** The item a chosen picture goes on, from what the match wrote. */
export function artworkItemId(kind: ProviderSearchResult['kind'], written: ManualMetadataResult): string | undefined {
  return kind === 'album' ? written.items.find((item) => item.kind === 'album')?.id : written.leaf_item_id;
}

interface Choosing {
  result: ProviderSearchResult;
  target: ProviderMatchRef;
  /** Undefined while the provider is asked. */
  options?: ProviderArtworkOption[];
  optionId?: string;
}

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
  const [choosing, setChoosing] = useState<Choosing>();
  const [matched, setMatched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      setChoosing(undefined);
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

  /** Pick a result: check the numbers, then ask the provider what pictures it has for it. */
  const pick = async (result: ProviderSearchResult) => {
    const target = providerMatchTarget(result, {
      season: wholeNumber(season), episode: wholeNumber(episode), disc: wholeNumber(disc), track: wholeNumber(track),
    });
    if (typeof target === 'string') {
      setError(target);
      return;
    }
    setError(undefined);
    setChoosing({ result, target });
    let options: ProviderArtworkOption[] = [];
    try {
      options = await manage.providerArtwork(result.ref, ARTWORK_ROLE[result.kind], { season_number: target.season_number, episode_number: target.episode_number });
    } catch {
      // No pictures to choose from is no reason not to match: the provider's default is staged anyway.
    }
    setChoosing((current) => (current?.result === result ? { ...current, options } : current));
  };

  const match = async ({ result, target, optionId }: Choosing) => {
    setBusy(true);
    setError(undefined);
    let applied;
    try {
      applied = await identifyUnmatched(manage, detail.item.id, { from: 'provider', target });
    } catch (cause) {
      setError(viewerErrorText(cause));
      setBusy(false);
      return;
    }
    const itemId = applied.applied === 'provider' ? artworkItemId(result.kind, applied.result) : undefined;
    if (optionId && itemId) {
      try {
        await manage.chooseArtwork(itemId, ARTWORK_ROLE[result.kind], optionId);
      } catch (cause) {
        // The file is matched; only the picture failed, so say that and go no further.
        setMatched(true);
        setBusy(false);
        setError(`Matched, but the chosen picture could not be used: ${viewerErrorText(cause)}`);
        return;
      }
    }
    onResolved();
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
              <li key={result.ref} className={choosing?.result === result ? 'identify-choosing' : undefined}>
                <div>
                  <strong>{[result.title, result.year].filter(Boolean).join(' · ')}</strong>
                  <span>{[result.artist, PROVIDER_LABEL[result.provider] ?? result.provider, result.catalogue_item_id ? 'already in the catalogue' : undefined].filter(Boolean).join(' · ')}</span>
                  {result.overview && <p className="identify-overview">{result.overview}</p>}
                  {choosing?.result === result && (
                    <ArtworkChoice
                      choosing={choosing}
                      busy={busy || matched}
                      onChoose={(optionId) => setChoosing({ ...choosing, optionId })}
                      onMatch={() => void match(choosing)}
                      onCancel={() => setChoosing(undefined)}
                    />
                  )}
                </div>
                {choosing?.result !== result && <button className="secondary-button" type="button" disabled={busy || matched} onClick={() => void pick(result)} data-tv-focusable="true">Match</button>}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

/**
 * The pictures the provider has for a picked result, to choose one of before
 * the match is made; none chosen keeps the one the server stages by default.
 */
function ArtworkChoice({ choosing, busy, onChoose, onMatch, onCancel }: {
  choosing: Choosing;
  busy: boolean;
  onChoose: (optionId: string | undefined) => void;
  onMatch: () => void;
  onCancel: () => void;
}) {
  const { options, optionId } = choosing;
  return (
    <div className="identify-artwork-choice">
      {options === undefined && <p className="list-note">Asking the provider for pictures…</p>}
      {options?.length === 0 && <p className="list-note">The provider has no pictures to choose from; it will use its default.</p>}
      {options && options.length > 0 && (
        <>
          <p className="list-note">{options.length === 1 ? 'The provider has one picture.' : `Choose one of ${options.length} pictures, or keep the provider's default.`}</p>
          <div className="identify-artwork-options" role="group" aria-label="Pictures to choose from">
            {options.map((option, index) => (
              <button
                key={option.option_id}
                type="button"
                className={option.option_id === optionId ? 'selected' : undefined}
                aria-pressed={option.option_id === optionId}
                aria-label={`Picture ${index + 1}${option.width && option.height ? `, ${option.width} by ${option.height}` : ''}${option.language ? `, ${option.language}` : ''}`}
                disabled={busy}
                onClick={() => onChoose(option.option_id === optionId ? undefined : option.option_id)}
                data-tv-focusable="true"
              >
                <img src={option.preview_url} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
      <div className="identify-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={onCancel} data-tv-focusable="true">Cancel</button>
        <button className="primary-button" type="button" disabled={busy} onClick={onMatch} data-tv-focusable="true">
          {optionId ? 'Match with this picture' : 'Match'}
        </button>
      </div>
    </div>
  );
}
