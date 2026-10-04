import type { ManageApi, UnmatchedFile } from '@machafoundation/core';
import { sameTitle } from './providerLookup';

/** Another unmatched file of the same album, from the same folder, and the track it says it is. */
export interface Sibling {
  file: UnmatchedFile;
  track?: number;
  disc?: number;
}

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

/** How many files' details are read at once: each read makes the server probe the file. */
const READ_AT_ONCE = 3;

/**
 * The other unmatched files in a file's folder whose own candidates name the
 * same album, so they can follow one matched by hand. A file whose details
 * cannot be read is left out.
 */
export async function albumSiblings(manage: ManageApi, file: UnmatchedFile, album: string, artist: string | undefined): Promise<Sibling[]> {
  const folder = folderOf(file.path);
  const others = (await manage.unmatched()).filter((other) => other.id !== file.id && folderOf(other.path) === folder);
  const found: Sibling[] = [];
  for (let start = 0; start < others.length; start += READ_AT_ONCE) {
    const read = await Promise.all(others.slice(start, start + READ_AT_ONCE).map(async (other) => {
      try {
        const { probes } = await manage.unmatchedDetail(other.id);
        const ofAlbum = probes.filter((probe) => probe.kind === 'track' && sameTitle(album, probe.album)
          && (!artist || !probe.artist || sameTitle(artist, probe.artist)));
        if (ofAlbum.length === 0) return undefined;
        const numbered = ofAlbum.find((probe) => probe.track_number != null) ?? ofAlbum[0];
        return { file: other, track: numbered.track_number ?? undefined, disc: numbered.disc_number ?? undefined };
      } catch {
        return undefined;
      }
    }));
    for (const sibling of read) if (sibling) found.push(sibling);
  }
  return found.sort((a, b) => (a.disc ?? 1) - (b.disc ?? 1) || (a.track ?? Infinity) - (b.track ?? Infinity));
}
