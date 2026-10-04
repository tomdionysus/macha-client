import type { ReactNode } from 'react';
import type { ProviderReleaseTrack, ProviderSearchResult, UnmatchedFile } from '@machafoundation/core';
import { Waiting } from '../../components/Status';
import { fileName } from '../ingest/format';
import type { Sibling } from './folderSiblings';

/** Where one file of the album stands while the album is matched. */
export type FileStatus = 'matching' | 'matched' | { left: string };

/** A file's place on the release: the track, and the disc when past the first. */
export function trackText(track: number | undefined, disc: number | undefined): string {
  if (track == null) return 'no track number';
  return disc != null && disc > 1 ? `disc ${disc}, track ${track}` : `track ${track}`;
}

/** The release's tracks; undefined while read, `unread` with why when they could not be. */
export type ReleaseTracks = ProviderReleaseTrack[] | { unread: string };

/**
 * The release's track at a file's place, by disc (the first when unstated) and number:
 * undefined when not known, null when the release has no such track.
 */
export function onRelease(tracks: ReleaseTracks | undefined, track: number | undefined, disc: number | undefined): ProviderReleaseTrack | null | undefined {
  if (!Array.isArray(tracks) || track == null) return undefined;
  return tracks.find((candidate) => candidate.track_number === track && (candidate.disc_number ?? 1) === (disc ?? 1)) ?? null;
}

function placeText(tracks: ReleaseTracks | undefined, track: number | undefined, disc: number | undefined): string {
  const place = trackText(track, disc);
  const found = onRelease(tracks, track, disc);
  if (found === null) return `${place}, which this release does not have`;
  return found ? `${place}, "${found.title}"` : place;
}

function statusText(status: FileStatus | undefined): string | undefined {
  if (status === 'matching') return 'Matching…';
  if (status === 'matched') return 'Matched';
  return status ? `Not matched: ${status.left}` : undefined;
}

/**
 * The album's files in this folder: this file, always matched, then the siblings its
 * candidates place on the album, each chosen by checkbox. A file with no track number
 * cannot be chosen, nor one whose track the release lacks. Each place shows the release's
 * title for that track once read, so a wrong number shows as a wrong title.
 */
export function AlbumFiles({ release, file, track, disc, siblings, tracks, selected, statuses, disabled, onSelect }: {
  release: ProviderSearchResult;
  file: UnmatchedFile;
  track?: number;
  disc?: number;
  siblings?: Sibling[];
  tracks?: ReleaseTracks;
  selected: ReadonlySet<string>;
  statuses: Readonly<Record<string, FileStatus>>;
  disabled: boolean;
  onSelect: (selected: Set<string>) => void;
}) {
  if (siblings === undefined) return <Waiting>Looking for this album's other unmatched files in this folder…</Waiting>;
  const numbered = siblings.filter((sibling) => sibling.track != null && onRelease(tracks, sibling.track, sibling.disc) !== null);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id); else next.delete(id);
    onSelect(next);
  };
  const row = (id: string, name: string, track: number | undefined, disc: number | undefined, checkbox: ReactNode, status?: FileStatus) => (
    <tr key={id} className={typeof status === 'object' ? 'identify-album-left' : undefined}>
      <td>{checkbox}</td>
      <td className="identify-album-file">{name}</td>
      <td className={onRelease(tracks, track, disc) === null ? 'identify-album-missing' : undefined}>{`${release.title} · ${placeText(tracks, track, disc)}`}</td>
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
      {tracks === undefined && <Waiting>Reading the release's track titles…</Waiting>}
      {tracks && !Array.isArray(tracks) && <p className="manage-error">The release's track titles could not be read: {tracks.unread}</p>}
      <table>
        <tbody>
          {row(file.id, `${fileName(file.path)} (this file)`, track, disc,
            <input type="checkbox" checked disabled aria-label={`${fileName(file.path)}, always matched`} />, statuses[file.id])}
          {siblings.map((sibling) => {
            const name = fileName(sibling.file.path);
            const missing = onRelease(tracks, sibling.track, sibling.disc) === null;
            return row(sibling.file.id, name, sibling.track, sibling.disc, (
              <input
                type="checkbox"
                checked={selected.has(sibling.file.id)}
                disabled={disabled || sibling.track == null || missing}
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
