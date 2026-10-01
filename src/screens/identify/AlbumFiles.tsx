import type { ReactNode } from 'react';
import type { ProviderSearchResult, UnmatchedFile } from '@machafoundation/core';
import { Waiting } from '../../components/Status';
import { fileName } from '../ingest/format';
import type { Sibling } from './folderSiblings';

/** Where one file of the album stands while the album is matched. */
export type FileStatus = 'matching' | 'matched' | { left: string };

/** A file's place on the release, as its MusicBrainz match reads: the track, and the disc where there is more than one. */
export function trackText(track: number | undefined, disc: number | undefined): string {
  if (track == null) return 'no track number';
  return disc != null && disc > 1 ? `disc ${disc}, track ${track}` : `track ${track}`;
}

function statusText(status: FileStatus | undefined): string | undefined {
  if (status === 'matching') return 'Matching…';
  if (status === 'matched') return 'Matched';
  return status ? `Not matched: ${status.left}` : undefined;
}

/**
 * The album's files in this folder and the MusicBrainz match each would
 * take: this file first, always matched, then the others its candidates
 * agree belong to the album, each chosen by its checkbox. A file that does
 * not say which track it is cannot be chosen: it is not guessed at.
 *
 * The match is the release and the track number the file's own tags give;
 * the track's title on the release is not checked here, because no route
 * gives a release's tracklist yet (asked of the server for after the
 * experiment).
 */
export function AlbumFiles({ release, file, track, disc, siblings, selected, statuses, disabled, onSelect }: {
  release: ProviderSearchResult;
  file: UnmatchedFile;
  track?: number;
  disc?: number;
  siblings?: Sibling[];
  selected: ReadonlySet<string>;
  statuses: Readonly<Record<string, FileStatus>>;
  disabled: boolean;
  onSelect: (selected: Set<string>) => void;
}) {
  if (siblings === undefined) return <Waiting>Looking for this album's other unmatched files in this folder…</Waiting>;
  const numbered = siblings.filter((sibling) => sibling.track != null);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id); else next.delete(id);
    onSelect(next);
  };
  const row = (id: string, name: string, place: string, checkbox: ReactNode, status?: FileStatus) => (
    <tr key={id} className={typeof status === 'object' ? 'identify-album-left' : undefined}>
      <td>{checkbox}</td>
      <td className="identify-album-file">{name}</td>
      <td>{`${release.title} · ${place}`}</td>
      <td className="identify-album-status">{statusText(status)}</td>
    </tr>
  );
  return (
    <div className="identify-album-files">
      <div className="identify-album-heading">
        <span>{siblings.length === 0 ? 'No other unmatched files of this album in this folder.' : 'Files in this folder, and their MusicBrainz match'}</span>
        {numbered.length > 0 && (
          <span className="identify-actions">
            <button className="secondary-button" type="button" disabled={disabled} onClick={() => onSelect(new Set(numbered.map((sibling) => sibling.file.id)))} data-tv-focusable="true">Select all</button>
            <button className="secondary-button" type="button" disabled={disabled} onClick={() => onSelect(new Set())} data-tv-focusable="true">Select none</button>
          </span>
        )}
      </div>
      <table>
        <tbody>
          {row(file.id, `${fileName(file.path)} (this file)`, trackText(track, disc),
            <input type="checkbox" checked disabled aria-label={`${fileName(file.path)}, always matched`} />, statuses[file.id])}
          {siblings.map((sibling) => {
            const name = fileName(sibling.file.path);
            return row(sibling.file.id, name, trackText(sibling.track, sibling.disc), (
              <input
                type="checkbox"
                checked={selected.has(sibling.file.id)}
                disabled={disabled || sibling.track == null}
                onChange={(event) => toggle(sibling.file.id, event.target.checked)}
                aria-label={`Match ${name}`}
                data-tv-focusable="true"
              />
            ), statuses[sibling.file.id]);
          })}
        </tbody>
      </table>
    </div>
  );
}
