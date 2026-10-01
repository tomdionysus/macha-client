import { useEffect, useState } from 'react';
import {
  identifyUnmatched,
  MachaEndpointError,
  type ManageApi,
  type ManualMetadataResult,
  type ProviderArtworkOption,
  type ProviderArtworkRole,
  type ProviderMatchRef,
  type ProviderSearchResult,
  type UnmatchedFile,
} from '@machafoundation/core';
import { Waiting } from '../../components/Status';
import { AlbumFiles, type FileStatus } from './AlbumFiles';
import { albumSiblings, type Sibling } from './folderSiblings';
import { viewerErrorText } from '../../text/viewerText';
import { NumberField, numberText, wholeNumber } from './fields';
import { pacedArtwork, pictureRelease } from './providerLookup';

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
export function ProviderRecord({ releases, file, manage, numbers: initial, disabled, onResolved }: {
  /** One record, or several releases no one could tell apart, shown and matched as one. */
  releases: ProviderSearchResult[];
  file: UnmatchedFile;
  manage: ManageApi;
  numbers: RecordNumbers;
  disabled?: boolean;
  onResolved: () => void;
}) {
  const [thumbnail, setThumbnail] = useState<string>();
  const [result, setResult] = useState(releases[0]);
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
  // The album's other files in this folder: undefined while looked for.
  const [siblings, setSiblings] = useState<Sibling[]>();
  // The album's other files to match too: every one that says which track it is, until unchosen.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, FileStatus>>({});
  const [someLeft, setSomeLeft] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void pictureRelease(manage, releases).then((shown) => {
      if (cancelled) return;
      setResult(shown.release);
      setThumbnail(shown.thumbnail);
    });
    return () => { cancelled = true; };
  }, [manage, releases]);

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

  useEffect(() => {
    if (!open || result.kind !== 'album' || siblings !== undefined) return undefined;
    let cancelled = false;
    void albumSiblings(manage, file, result.title, result.artist)
      .catch(() => [])
      .then((found) => {
        if (cancelled) return;
        setSiblings(found);
        setSelected(new Set(found.filter((sibling) => sibling.track != null).map((sibling) => sibling.file.id)));
      });
    return () => { cancelled = true; };
  }, [open, result, siblings, manage, file]);

  const mark = (id: string, status: FileStatus) => setStatuses((current) => ({ ...current, [id]: status }));

  /**
   * The chosen files of the album, one after another, against the same
   * release, each by the track its own candidates state; each row says how
   * it went. Answers whether any was left unmatched.
   */
  const matchSiblings = async (ref: string): Promise<boolean> => {
    let left = false;
    let unanswered = false;
    for (const sibling of (siblings ?? []).filter((candidate) => selected.has(candidate.file.id) && candidate.track != null)) {
      // A change the server did not answer is still running there, and the
      // next would queue behind it (seen: each sat 27 s to 3 min before a
      // conflict), so the rest are not sent.
      if (unanswered) {
        mark(sibling.file.id, { left: 'not tried, because the server did not answer the one before.' });
        continue;
      }
      mark(sibling.file.id, 'matching');
      try {
        await identifyUnmatched(manage, sibling.file.id, {
          from: 'provider', target: { ref, track_number: sibling.track!, ...(sibling.disc != null ? { disc_number: sibling.disc } : {}) },
        });
        mark(sibling.file.id, 'matched');
      } catch (cause) {
        mark(sibling.file.id, { left: viewerErrorText(cause) });
        left = true;
        unanswered = cause instanceof MachaEndpointError && cause.kind === 'transport';
      }
    }
    return left;
  };

  const match = async () => {
    if (typeof target === 'string') {
      setError(target);
      return;
    }
    setBusy(true);
    setError(undefined);
    let applied;
    mark(file.id, 'matching');
    try {
      applied = await identifyUnmatched(manage, file.id, { from: 'provider', target });
      mark(file.id, 'matched');
    } catch (cause) {
      setStatuses({});
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
    if (await matchSiblings(target.ref)) {
      // This file is matched, so nothing here can be done again; each row says what was left, and the way back is offered.
      setMatched(true);
      setBusy(false);
      setSomeLeft(true);
      return;
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
        <span className="identify-record-meta">{[
          result.artist,
          PROVIDER_LABEL[result.provider] ?? result.provider,
          releases.length > 1 ? `${releases.length} releases` : undefined,
          releases.some((release) => release.catalogue_item_id) ? 'already in the catalogue' : undefined,
        ].filter(Boolean).join(' · ')}</span>
        {result.overview && <p className="identify-overview">{result.overview}</p>}
        {open && (
          <div className="identify-artwork-choice">
            {/* The form's field styling for the numbers alone: it would restyle the picture buttons too. */}
            {result.kind === 'show' && (
              <div className="manage-manual-form manage-field-row">
                <NumberField label="Season" value={season} onChange={setSeason} disabled={held} />
                <NumberField label="Episode" value={episode} onChange={setEpisode} disabled={held} />
              </div>
            )}
            {result.kind === 'album' && (
              <div className="manage-manual-form manage-field-row">
                <NumberField label="Disc" value={disc} onChange={setDisc} disabled={held} />
                <NumberField label="Track" value={track} onChange={setTrack} disabled={held} />
              </div>
            )}
            <Pictures options={picturesKey === undefined ? [] : options} optionId={optionId} disabled={held} onChoose={setOptionId} />
            {result.kind === 'album' && (
              <AlbumFiles
                release={result}
                file={file}
                track={numbers.track}
                disc={numbers.disc}
                siblings={siblings}
                selected={selected}
                statuses={statuses}
                disabled={held}
                onSelect={setSelected}
              />
            )}
            {error && <p className="manage-error" role="alert">{error}</p>}
            {someLeft && (
              <div className="manage-error" role="alert">
                <p>Some of the album's files could not be matched; each says why above.</p>
                <button className="secondary-button" type="button" onClick={onResolved} data-tv-focusable="true">Back to the list</button>
              </div>
            )}
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
  if (options === undefined) return <Waiting>Asking the provider for pictures…</Waiting>;
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
