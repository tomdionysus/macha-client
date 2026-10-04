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
 * Finds TMDB and MusicBrainz records from a file's candidates: the server's guesses from
 * its name, tags or path, for which the scanner found no match it trusted.
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

/** A movie by its title, an episode by its series, a track by its album; undefined when the candidate names none (a track with no album). */
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

/** A title as compared: lower case, letters and digits of any script, single spaces. */
export function comparableTitle(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Whether a provider title is the one named, allowing for an article, a prefix or a subtitle either side. */
export function sameTitle(named: string, found: string): boolean {
  const a = comparableTitle(named);
  const b = comparableTitle(found);
  return Boolean(a && b) && (a === b || a.includes(b) || b.includes(a));
}

/** How many provider results are read for each thing a file names. */
const RESULTS_READ = 8;

const searches = new WeakMap<ManageApi, Map<string, Promise<ProviderSearchResult[]>>>();

/**
 * A lookup's results, asked once per API: several callers share the same searches, and
 * MusicBrainz is paced at one a second. A failure is no results and is not kept.
 */
function searchOnce(manage: ManageApi, lookup: Lookup): Promise<ProviderSearchResult[]> {
  let asked = searches.get(manage);
  if (!asked) { asked = new Map(); searches.set(manage, asked); }
  const key = `${lookup.searchKind}|${lookup.query}|${lookup.year ?? ''}`;
  let found = asked.get(key);
  if (!found) {
    // The artist is compared loosely in `agreeingRecords`, not sent as the provider's
    // filter, which matches only the exact credit.
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
 * Groups the releases a person cannot tell apart (same title, artist and year), in the
 * provider's order. Each group is shown once and matched by one of its releases.
 */
export function groupRecords(results: readonly ProviderSearchResult[]): ProviderSearchResult[][] {
  const groups = new Map<string, ProviderSearchResult[]>();
  for (const result of results) {
    const key = [result.provider, result.kind, comparableTitle(result.title), comparableTitle(result.artist ?? ''), result.year ?? ''].join('|');
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

/** For each distinct thing the candidates name, in order, the provider results that agree; each record once. */
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
 * A record's pictures, one MusicBrainz request at a time: the server paces it at one a
 * second, and requests queued there outlast core's 8 s limit. TMDB is asked at once.
 */
export function pacedArtwork(manage: ManageApi, ref: string, role: ProviderArtworkRole, numbers?: { season_number?: number; episode_number?: number }): Promise<ProviderArtworkOption[]> {
  if (!ref.startsWith('musicbrainz:')) return manage.providerArtwork(ref, role, numbers);
  const asked = (queues.get(manage) ?? Promise.resolve()).catch(() => undefined).then(() => manage.providerArtwork(ref, role, numbers));
  queues.set(manage, asked);
  return asked;
}

const thumbnails = new WeakMap<ManageApi, Map<string, Promise<string | undefined>>>();

/** The release a group is shown and matched by: the first of the first few with a picture. */
export async function pictureRelease(manage: ManageApi, releases: readonly ProviderSearchResult[]): Promise<{ release: ProviderSearchResult; thumbnail?: string }> {
  for (const release of releases.slice(0, RECORDS_TRIED)) {
    const thumbnail = await recordThumbnail(manage, release);
    if (thumbnail) return { release, thumbnail };
  }
  return { release: releases[0] };
}

/** A record's small picture (poster or cover); undefined when it has none or the provider fails. */
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

/** A candidate's picture from the provider record it names; a manual entry applies it by `ref` (`chooseArtwork`). */
export interface CandidatePicture {
  kind: MediaProbeCandidate['kind'];
  ref: string;
  role: ProviderArtworkRole;
  option: ProviderArtworkOption;
  season_number?: number;
  episode_number?: number;
}

/** The source as named to the viewer: TMDB, or the Cover Art Archive for a MusicBrainz release. */
export function pictureSource(picture: Pick<CandidatePicture, 'ref'>): string {
  return picture.ref.startsWith('tmdb:') ? 'TMDB' : 'the Cover Art Archive';
}

/** How many agreeing records are asked for a picture before giving up. */
const RECORDS_TRIED = 3;

/** The first image for the candidate's role from the first agreeing record that has one; an episode's still needs its numbers. */
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

/** Puts the picture on what a manual entry wrote: a cover on the album, otherwise on the leaf item. */
export async function applyCandidatePicture(manage: ManageApi, picture: CandidatePicture, written: ManualMetadataResult): Promise<void> {
  const itemId = picture.role === 'cover' ? written.items.find((item) => item.kind === 'album')?.id : written.leaf_item_id;
  if (!itemId) return;
  await manage.chooseArtwork(itemId, picture.role, picture.option.option_id, {
    ref: picture.ref, season_number: picture.season_number, episode_number: picture.episode_number,
  });
}
