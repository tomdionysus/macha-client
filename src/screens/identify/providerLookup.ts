import type {
  ManageApi,
  ManualMetadataResult,
  MediaProbeCandidate,
  ProviderArtworkOption,
  ProviderArtworkRole,
  ProviderSearchKind,
  ProviderSearchResult,
} from '@machafoundation/core';

/**
 * Finding TMDB and MusicBrainz records from what an unmatched file says
 * about itself. A candidate is the server's local guess, from the file's
 * name, tags or path; the scanner already searched the provider with it and
 * found no match it trusted. Here the same words find the records a person
 * can choose from.
 */

/** What to ask the provider for one thing a candidate names. */
export interface Lookup {
  key: string;
  query: string;
  searchKind: ProviderSearchKind;
  year?: number;
  artist?: string;
  /** The numbers that pick the file out of the record, where the candidate states them. */
  season_number?: number;
  episode_number?: number;
  disc_number?: number;
  track_number?: number;
}

/**
 * What to ask the provider for a candidate: a movie by its title, an episode
 * by its series, a track by its album. Undefined when it names nothing a
 * provider lists (a track with no album).
 */
export function recordLookup(candidate: MediaProbeCandidate): Lookup | undefined {
  if (candidate.kind === 'movie') {
    if (!candidate.title) return undefined;
    return { key: `movie|${candidate.title}|${candidate.year ?? ''}`, query: candidate.title, searchKind: 'movie', year: candidate.year ?? undefined };
  }
  if (candidate.kind === 'episode') {
    if (!candidate.series) return undefined;
    return {
      key: `show|${candidate.series}`, query: candidate.series, searchKind: 'show',
      season_number: candidate.season_number ?? undefined, episode_number: candidate.episode_number ?? undefined,
    };
  }
  if (!candidate.album) return undefined;
  return {
    key: `album|${candidate.artist}|${candidate.album}`, query: candidate.album, searchKind: 'album', artist: candidate.artist || undefined,
    disc_number: candidate.disc_number ?? undefined, track_number: candidate.track_number ?? undefined,
  };
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Whether a provider title is the one named, allowing for an article, a prefix or a subtitle either side. */
export function sameTitle(named: string, found: string): boolean {
  const a = comparable(named);
  const b = comparable(found);
  return Boolean(a && b) && (a === b || a.includes(b) || b.includes(a));
}

/** How many provider results are read for each thing a file names. */
const RESULTS_READ = 8;

const searches = new WeakMap<ManageApi, Map<string, Promise<ProviderSearchResult[]>>>();

/**
 * The provider's results for a lookup, asked once per page's API: the
 * suggestions, the candidates' pictures and a record's thumbnail all start
 * from the same few searches, and MusicBrainz is paced at one a second.
 * A failure is no results, and is not kept, so a later ask tries again.
 */
function searchOnce(manage: ManageApi, lookup: Lookup): Promise<ProviderSearchResult[]> {
  let asked = searches.get(manage);
  if (!asked) { asked = new Map(); searches.set(manage, asked); }
  const key = `${lookup.searchKind}|${lookup.query}|${lookup.year ?? ''}`;
  let found = asked.get(key);
  if (!found) {
    // The artist is compared below rather than sent as the provider's
    // filter, which is exact: a file tagged "DJ Someone" found nothing for
    // MusicBrainz's "Someone" (seen live), and without the comparison the
    // first result was another artist's album of the same name.
    found = manage.providerSearch(lookup.query, lookup.searchKind, { year: lookup.year, limit: RESULTS_READ })
      .catch(() => { asked.delete(key); return []; });
    asked.set(key, found);
  }
  return found;
}

/** The results that are the thing the lookup named: its title and, for an album, its artist. */
export async function agreeingRecords(manage: ManageApi, lookup: Lookup): Promise<ProviderSearchResult[]> {
  const results = await searchOnce(manage, lookup);
  return results.filter((result) => sameTitle(lookup.query, result.title)
    && (!lookup.artist || !result.artist || sameTitle(lookup.artist, result.artist)));
}

/**
 * Records a person could not tell apart, as one: a MusicBrainz album is
 * often several releases (countries, formats, reissues) that the provider
 * answers with the same title, artist and year (five of one album, seen
 * live), and choosing among them by eye is choosing blind. Grouped in the
 * provider's order; each group is shown once and matched by one of its
 * releases.
 */
export function groupRecords(results: readonly ProviderSearchResult[]): ProviderSearchResult[][] {
  const groups = new Map<string, ProviderSearchResult[]>();
  for (const result of results) {
    const key = [result.provider, result.kind, comparable(result.title), comparable(result.artist ?? ''), result.year ?? ''].join('|');
    const group = groups.get(key);
    if (group) group.push(result);
    else groups.set(key, [result]);
  }
  return [...groups.values()];
}

/** A record suggested for a file (its indistinguishable releases together), with the numbers its candidate stated. */
export interface Suggestion {
  releases: ProviderSearchResult[];
  lookup: Lookup;
}

/** How many suggestions are shown; past this, searching is quicker than reading. */
const SUGGESTIONS_SHOWN = 8;

/**
 * The records a file most likely is: for each distinct thing its candidates
 * name, in their order, the provider's results that agree with it. A record
 * two candidates both found is suggested once.
 */
export async function findSuggestions(manage: ManageApi, candidates: readonly MediaProbeCandidate[]): Promise<Suggestion[]> {
  const lookups = new Map<string, Lookup>();
  for (const candidate of candidates) {
    const lookup = recordLookup(candidate);
    if (lookup && !lookups.has(lookup.key)) lookups.set(lookup.key, lookup);
  }
  const found = await Promise.all([...lookups.values()].map(async (lookup) => (
    groupRecords(await agreeingRecords(manage, lookup)).map((releases) => ({ releases, lookup }))
  )));
  const seen = new Set<string>();
  return found.flat().filter(({ releases }) => !seen.has(releases[0].ref) && seen.add(releases[0].ref)).slice(0, SUGGESTIONS_SHOWN);
}

const queues = new WeakMap<ManageApi, Promise<unknown>>();

/**
 * Ask the provider for a record's pictures, one MusicBrainz record at a
 * time. The server paces MusicBrainz at one request a second, so five asked
 * at once queued there past core's 8 s limit, were cut off and asked again
 * on another node (seen live); one after another, each answers in about a
 * second. TMDB is not paced and is asked at once.
 */
export function pacedArtwork(manage: ManageApi, ref: string, role: ProviderArtworkRole, numbers?: { season_number?: number; episode_number?: number }): Promise<ProviderArtworkOption[]> {
  if (!ref.startsWith('musicbrainz:')) return manage.providerArtwork(ref, role, numbers);
  const asked = (queues.get(manage) ?? Promise.resolve()).catch(() => undefined).then(() => manage.providerArtwork(ref, role, numbers));
  queues.set(manage, asked);
  return asked;
}

const thumbnails = new WeakMap<ManageApi, Map<string, Promise<string | undefined>>>();

/**
 * The release of a group to show and match by: the first, among the first
 * few, that has a picture, so the picture shown is the one the match brings.
 */
export async function pictureRelease(manage: ManageApi, releases: readonly ProviderSearchResult[]): Promise<{ release: ProviderSearchResult; thumbnail?: string }> {
  for (const release of releases.slice(0, RECORDS_TRIED)) {
    const thumbnail = await recordThumbnail(manage, release);
    if (thumbnail) return { release, thumbnail };
  }
  return { release: releases[0] };
}

/**
 * The small picture a record is shown with: a movie's or series' poster, an
 * album release's cover. Undefined when it has none or the provider fails.
 */
export function recordThumbnail(manage: ManageApi, result: Pick<ProviderSearchResult, 'ref' | 'kind'>): Promise<string | undefined> {
  let asked = thumbnails.get(manage);
  if (!asked) { asked = new Map(); thumbnails.set(manage, asked); }
  let found = asked.get(result.ref);
  if (!found) {
    found = pacedArtwork(manage, result.ref, result.kind === 'album' ? 'cover' : 'poster')
      .then(([option]) => option?.preview_url, () => undefined);
    asked.set(result.ref, found);
  }
  return found;
}

/**
 * A picture for a candidate, from the provider's record of what it names: a
 * movie's poster, an episode's still, a track's album cover. Applied to what
 * a manual entry creates by naming that record (`chooseArtwork` with `ref`).
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

/** How many agreeing records are asked for a picture before giving up. */
const RECORDS_TRIED = 3;

/**
 * Find a candidate's picture: the first image for its role from the first
 * agreeing record that has one. An album is several releases and only some
 * have a cover (seen live: the first of one album's had none, the next two
 * did), so the next is tried. An episode's still needs its numbers.
 */
export async function findCandidatePicture(manage: ManageApi, candidate: MediaProbeCandidate): Promise<CandidatePicture | undefined> {
  const lookup = recordLookup(candidate);
  if (!lookup) return undefined;
  const role: ProviderArtworkRole = lookup.searchKind === 'movie' ? 'poster' : lookup.searchKind === 'show' ? 'still' : 'cover';
  if (role === 'still' && (lookup.season_number == null || lookup.episode_number == null)) return undefined;
  const numbers = { season_number: lookup.season_number, episode_number: lookup.episode_number };
  try {
    for (const result of (await agreeingRecords(manage, lookup)).slice(0, RECORDS_TRIED)) {
      const [option] = await pacedArtwork(manage, result.ref, role, numbers);
      if (option) return { kind: candidate.kind, ref: result.ref, role, option, ...numbers };
    }
  } catch {
    // A provider failure is the same as no picture.
  }
  return undefined;
}

/** Pictures for several candidates, looked up once per distinct thing they name. */
export function findCandidatePictures(manage: ManageApi, candidates: readonly MediaProbeCandidate[]): Array<Promise<CandidatePicture | undefined>> {
  const asked = new Map<string, Promise<CandidatePicture | undefined>>();
  return candidates.map((candidate) => {
    const lookup = recordLookup(candidate);
    if (!lookup) return Promise.resolve(undefined);
    // An episode's still is its own, so episodes are told apart by their numbers.
    const key = `${lookup.key}|${lookup.season_number ?? ''}|${lookup.episode_number ?? ''}`;
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
