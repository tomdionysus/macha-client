import type {
  ManageApi,
  ManualMetadataResult,
  MediaProbeCandidate,
  ProviderArtworkOption,
  ProviderArtworkRole,
  ProviderSearchKind,
} from '@machafoundation/core';

/**
 * A picture for a candidate, from the metadata provider's record of what the
 * candidate names: a movie's poster, an episode's still, a track's album
 * cover. The server cannot yet read a file's own embedded picture, so this
 * is the provider's, found by the candidate's words, and applied to what a
 * manual entry creates by naming that record (`chooseArtwork` with `ref`).
 */
export interface CandidatePicture {
  kind: MediaProbeCandidate['kind'];
  ref: string;
  role: ProviderArtworkRole;
  option: ProviderArtworkOption;
  season_number?: number;
  episode_number?: number;
}

/**
 * Where a picture comes from, as a viewer would look for it: TMDB's own
 * images for a TMDB record; for a MusicBrainz release, the Cover Art
 * Archive, which holds the covers MusicBrainz itself does not.
 */
export function pictureSource(picture: Pick<CandidatePicture, 'ref'>): string {
  return picture.ref.startsWith('tmdb:') ? 'TMDB' : 'the Cover Art Archive';
}

interface Lookup {
  key: string;
  query: string;
  searchKind: ProviderSearchKind;
  role: ProviderArtworkRole;
  year?: number;
  artist?: string;
  season_number?: number;
  episode_number?: number;
}

/** What to ask the provider for a candidate, or undefined when it names nothing a provider lists. */
export function pictureLookup(candidate: MediaProbeCandidate): Lookup | undefined {
  if (candidate.kind === 'movie') {
    if (!candidate.title) return undefined;
    return { key: `movie|${candidate.title}|${candidate.year ?? ''}`, query: candidate.title, searchKind: 'movie', role: 'poster', year: candidate.year ?? undefined };
  }
  if (candidate.kind === 'episode') {
    if (!candidate.series || candidate.season_number == null || candidate.episode_number == null) return undefined;
    return {
      key: `episode|${candidate.series}|${candidate.season_number}|${candidate.episode_number}`,
      query: candidate.series, searchKind: 'show', role: 'still',
      season_number: candidate.season_number, episode_number: candidate.episode_number,
    };
  }
  if (!candidate.album) return undefined;
  return { key: `track|${candidate.artist}|${candidate.album}`, query: candidate.album, searchKind: 'album', role: 'cover', artist: candidate.artist || undefined };
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Whether a provider title is the one the candidate named, allowing for an article or subtitle either side. */
export function sameTitle(named: string, found: string): boolean {
  const a = comparable(named);
  const b = comparable(found);
  return Boolean(a && b) && (a === b || a.includes(b) || b.includes(a));
}

/** How many provider results are read for one that agrees with the candidate. */
const RESULTS_READ = 5;
/** How many agreeing records are asked for a picture before giving up. */
const RECORDS_TRIED = 3;

/**
 * Find a candidate's picture: among the provider's results whose title is
 * the one the candidate named and, for an album, whose artist is too, the
 * first image for the role of the first that has one. Undefined when there is
 * none; a provider failure is the same as no picture.
 *
 * The artist is compared here rather than sent as the provider's filter,
 * which is exact: a file tagged "DJ Someone" found nothing for MusicBrainz's
 * "Someone" (seen live), and without it the first result was another
 * artist's album of the same name.
 */
export async function findCandidatePicture(manage: ManageApi, candidate: MediaProbeCandidate): Promise<CandidatePicture | undefined> {
  const lookup = pictureLookup(candidate);
  if (!lookup) return undefined;
  try {
    const results = await manage.providerSearch(lookup.query, lookup.searchKind, { year: lookup.year, limit: RESULTS_READ });
    const agreeing = results.filter((result) => sameTitle(lookup.query, result.title)
      && (!lookup.artist || !result.artist || sameTitle(lookup.artist, result.artist)));
    const numbers = { season_number: lookup.season_number, episode_number: lookup.episode_number };
    // An album is several releases, and only some have a cover (seen live:
    // the first of one album's had none, the next two did); so the next is tried.
    for (const result of agreeing.slice(0, RECORDS_TRIED)) {
      const [option] = await manage.providerArtwork(result.ref, lookup.role, numbers);
      if (option) return { kind: candidate.kind, ref: result.ref, role: lookup.role, option, ...numbers };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Look up pictures for several candidates, once per distinct thing they
 * name: three candidates for one album ask the provider once.
 */
export function findCandidatePictures(manage: ManageApi, candidates: readonly MediaProbeCandidate[]): Array<Promise<CandidatePicture | undefined>> {
  const asked = new Map<string, Promise<CandidatePicture | undefined>>();
  return candidates.map((candidate) => {
    const key = pictureLookup(candidate)?.key;
    if (!key) return Promise.resolve(undefined);
    const known = asked.get(key);
    if (known) return known.then((picture) => picture && { ...picture, kind: candidate.kind });
    const found = findCandidatePicture(manage, candidate);
    asked.set(key, found);
    return found;
  });
}

/**
 * Put a candidate's picture on what a manual entry wrote: a cover on the
 * album, a poster or still on the item itself. The written items are manual
 * ones with no provider reference, so the choice names the record.
 */
export async function applyCandidatePicture(manage: ManageApi, picture: CandidatePicture, written: ManualMetadataResult): Promise<void> {
  const itemId = picture.role === 'cover' ? written.items.find((item) => item.kind === 'album')?.id : written.leaf_item_id;
  if (!itemId) return;
  await manage.chooseArtwork(itemId, picture.role, picture.option.option_id, {
    ref: picture.ref, season_number: picture.season_number, episode_number: picture.episode_number,
  });
}
