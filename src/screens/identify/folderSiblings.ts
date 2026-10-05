import type { ManageApi, MediaProbeCandidate, UnmatchedFile } from '@machafoundation/core';
import { sameTitle } from './providerLookup';

/**
 * Another unmatched file of the same album or series, from the same folder, and its place
 * there: a track (and disc), or an episode (and season).
 */
export interface Sibling {
  file: UnmatchedFile;
  /** The track or episode number. */
  number?: number;
  /** The disc or season number. */
  group?: number;
}

/** Which of a file's candidates put it in the same set, and where in it. */
export interface SetOf {
  belongs: (probe: MediaProbeCandidate) => boolean;
  place: (probe: MediaProbeCandidate) => { number?: number; group?: number };
}

/** An album, by title and, where both state one, artist. */
export function albumSet(album: string, artist: string | undefined): SetOf {
  return {
    belongs: (probe) => probe.kind === 'track' && sameTitle(album, probe.album) && (!artist || !probe.artist || sameTitle(artist, probe.artist)),
    place: (probe) => ({ number: probe.track_number ?? undefined, group: probe.disc_number ?? undefined }),
  };
}

/** A series, by title; which season is the viewer's to choose, so every season is found. */
export function seriesSet(series: string): SetOf {
  return {
    belongs: (probe) => probe.kind === 'episode' && sameTitle(series, probe.series),
    place: (probe) => ({ number: probe.episode_number ?? undefined, group: probe.season_number ?? undefined }),
  };
}

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

/** How many files' details are read at once: each read makes the server probe the file. */
const READ_AT_ONCE = 3;

/**
 * The other unmatched files in a file's folder whose own candidates put them in the same
 * set, so they can follow one matched by hand. A file whose details cannot be read is left out.
 */
export async function folderSiblings(manage: ManageApi, file: UnmatchedFile, set: SetOf): Promise<Sibling[]> {
  const folder = folderOf(file.path);
  const others = (await manage.unmatched()).filter((other) => other.id !== file.id && folderOf(other.path) === folder);
  const found: Sibling[] = [];
  for (let start = 0; start < others.length; start += READ_AT_ONCE) {
    const read = await Promise.all(others.slice(start, start + READ_AT_ONCE).map(async (other) => {
      try {
        const { probes } = await manage.unmatchedDetail(other.id);
        const inSet = probes.filter(set.belongs);
        if (inSet.length === 0) return undefined;
        const placed = inSet.find((probe) => set.place(probe).number != null) ?? inSet[0];
        return { file: other, ...set.place(placed) };
      } catch {
        return undefined;
      }
    }));
    for (const sibling of read) if (sibling) found.push(sibling);
  }
  return found.sort((a, b) => (a.group ?? 1) - (b.group ?? 1) || (a.number ?? Infinity) - (b.number ?? Infinity));
}
