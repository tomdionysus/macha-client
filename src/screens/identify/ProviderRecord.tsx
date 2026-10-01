import { useEffect, useState } from 'react';
import {
  identifyUnmatched,
  type ManageApi,
  type ManualMetadataResult,
  type ProviderArtworkOption,
  type ProviderArtworkRole,
  type ProviderMatchRef,
  type ProviderSearchResult,
} from '@machafoundation/core';
import { viewerErrorText } from '../../text/viewerText';
import { NumberField, numberText, wholeNumber } from './fields';
import { pacedArtwork, recordThumbnail } from './providerLookup';

export const PROVIDER_LABEL: Record<string, string> = { tmdb: 'TMDB', musicbrainz: 'MusicBrainz' };

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

/** The numbers that pick a file out of a series or an album. */
export interface RecordNumbers {
  season?: number;
  episode?: number;
  disc?: number;
  track?: number;
}

/**
 * What to send to match a file to a provider result, or a sentence for what
 * is missing: a series needs the season and episode that are this file, and
 * an album the track that is (and, on a set, the disc).
 */
export function providerMatchTarget(result: Pick<ProviderSearchResult, 'ref' | 'kind'>, numbers: RecordNumbers): ProviderMatchRef | string {
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
 * One TMDB or MusicBrainz record a file could be, whether suggested or
 * searched for: its picture, title, year, artist and overview, and "Use
 * this", which asks for the numbers that pick the file out of it (seeded from
 * what the file says), offers the record's pictures, and matches. The server
 * fetches the record, builds its hierarchy (reusing what the catalogue
 * holds), stages its artwork and binds the file, as a scan match does.
 */
export function ProviderRecord({ result, fileId, manage, numbers: initial, disabled, onResolved }: {
  result: ProviderSearchResult;
  fileId: string;
  manage: ManageApi;
  numbers: RecordNumbers;
  disabled?: boolean;
  onResolved: () => void;
}) {
  const [thumbnail, setThumbnail] = useState<string>();
  const [open, setOpen] = useState(false);
  const [season, setSeason] = useState(numberText(initial.season));
  const [episode, setEpisode] = useState(numberText(initial.episode));
  const [disc, setDisc] = useState(numberText(initial.disc));
  const [track, setTrack] = useState(numberText(initial.track));
  const [options, setOptions] = useState<ProviderArtworkOption[]>();
  const [optionId, setOptionId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [matched, setMatched] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void recordThumbnail(manage, result).then((url) => { if (!cancelled) setThumbnail(url); });
    return () => { cancelled = true; };
  }, [manage, result]);

  const numbers: RecordNumbers = { season: wholeNumber(season), episode: wholeNumber(episode), disc: wholeNumber(disc), track: wholeNumber(track) };
  const target = providerMatchTarget(result, numbers);
  // An episode's pictures are its stills, so they are asked for once its numbers are known.
  const picturesKey = open && typeof target !== 'string' ? `${target.season_number ?? ''}|${target.episode_number ?? ''}` : undefined;

  useEffect(() => {
    if (picturesKey === undefined || typeof target === 'string') return undefined;
    let cancelled = false;
    setOptions(undefined);
    setOptionId(undefined);
    pacedArtwork(manage, result.ref, ARTWORK_ROLE[result.kind], { season_number: target.season_number, episode_number: target.episode_number })
      // No pictures to choose from is no reason not to match: the provider's default is staged anyway.
      .catch(() => [])
      .then((found) => { if (!cancelled) setOptions(found); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the numbers the pictures depend on
  }, [manage, result, picturesKey]);

  const match = async () => {
    if (typeof target === 'string') {
      setError(target);
      return;
    }
    setBusy(true);
    setError(undefined);
    let applied;
    try {
      applied = await identifyUnmatched(manage, fileId, { from: 'provider', target });
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

  const held = busy || matched || Boolean(disabled);
  return (
    <li className={open ? 'identify-choosing' : undefined}>
      <span className={`identify-art${result.kind === 'album' ? ' identify-art-square' : ''}`} aria-hidden="true">
        {thumbnail ? <img src={thumbnail} alt="" loading="lazy" /> : null}
      </span>
      <div>
        <strong>{[result.title, result.year].filter(Boolean).join(' · ')}</strong>
        <span>{[result.artist, PROVIDER_LABEL[result.provider] ?? result.provider, result.catalogue_item_id ? 'already in the catalogue' : undefined].filter(Boolean).join(' · ')}</span>
        {result.overview && <p className="identify-overview">{result.overview}</p>}
        {open && (
          <div className="identify-artwork-choice manage-manual-form">
            {result.kind === 'show' && (
              <div className="manage-field-row">
                <NumberField label="Season" value={season} onChange={setSeason} disabled={held} />
                <NumberField label="Episode" value={episode} onChange={setEpisode} disabled={held} />
              </div>
            )}
            {result.kind === 'album' && (
              <div className="manage-field-row">
                <NumberField label="Disc" value={disc} onChange={setDisc} disabled={held} />
                <NumberField label="Track" value={track} onChange={setTrack} disabled={held} />
              </div>
            )}
            <Pictures options={picturesKey === undefined ? [] : options} optionId={optionId} disabled={held} onChoose={setOptionId} />
            {error && <p className="manage-error" role="alert">{error}</p>}
            <div className="identify-actions">
              <button className="secondary-button" type="button" disabled={held} onClick={() => { setOpen(false); setError(undefined); }} data-tv-focusable="true">Cancel</button>
              <button className="primary-button" type="button" disabled={held} onClick={() => void match()} data-tv-focusable="true">
                {optionId ? 'Match with this picture' : 'Match'}
              </button>
            </div>
          </div>
        )}
      </div>
      {!open && <button className="secondary-button" type="button" disabled={held} onClick={() => setOpen(true)} data-tv-focusable="true">Use this</button>}
    </li>
  );
}

/**
 * The pictures the provider has for a record, to choose one of before the
 * match is made; none chosen keeps the one the server stages by default.
 */
function Pictures({ options, optionId, disabled, onChoose }: {
  options?: ProviderArtworkOption[];
  optionId?: string;
  disabled: boolean;
  onChoose: (optionId: string | undefined) => void;
}) {
  if (options === undefined) return <p className="list-note">Asking the provider for pictures…</p>;
  if (options.length === 0) return <p className="list-note">No pictures to choose from; the provider's default is used.</p>;
  return (
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
            disabled={disabled}
            onClick={() => onChoose(option.option_id === optionId ? undefined : option.option_id)}
            data-tv-focusable="true"
          >
            <img src={option.preview_url} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </>
  );
}
