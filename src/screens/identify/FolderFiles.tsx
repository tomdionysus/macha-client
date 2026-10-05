import type { ReactNode } from 'react';
import type { ProviderReleaseTrack, ProviderSearchResult, UnmatchedFile } from '@machafoundation/core';
import { Waiting } from '../../components/Status';
import { fileName } from '../ingest/format';
import type { Sibling } from './folderSiblings';

/** Where one file stands while the set is matched. */
export type FileStatus = 'matching' | 'matched' | { left: string };

/** The set a folder's files are matched into: an album's tracks, or one season's episodes. */
export type FolderSet = 'album' | 'season';

/** A file's place on the release: the track, and the disc when past the first. */
export function trackText(track: number | undefined, disc: number | undefined): string {
  if (track == null) return 'no track number';
  return disc != null && disc > 1 ? `disc ${disc}, track ${track}` : `track ${track}`;
}

/** A file's place in the series: a special under season 0 can sit beside a season's episodes. */
function episodeText(episode: number | undefined, season: number | undefined): string {
  if (episode == null) return 'no episode number';
  return season == null ? `episode ${episode}` : `season ${season}, episode ${episode}`;
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

function placeText(set: FolderSet, tracks: ReleaseTracks | undefined, number: number | undefined, group: number | undefined): string {
  if (set === 'season') return episodeText(number, group);
  const place = trackText(number, group);
  const found = onRelease(tracks, number, group);
  if (found === null) return `${place}, which this release does not have`;
  return found ? `${place}, "${found.title}"` : place;
}

function statusText(status: FileStatus | undefined): string | undefined {
  if (status === 'matching') return 'Matching…';
  if (status === 'matched') return 'Matched';
  return status ? `Not matched: ${status.left}` : undefined;
}

/**
 * The set's files in this folder: this file, always matched, then the siblings its
 * candidates place in the set, each chosen by checkbox. A file with no number cannot be
 * chosen, nor a track the release lacks. An album's places show the release's title for
 * each track once read, so a wrong number shows as a wrong title.
 */
export function FolderFiles({ set, record, provider, file, number, group, siblings, tracks, selected, statuses, disabled, onSelect }: {
  set: FolderSet;
  record: ProviderSearchResult;
  /** The provider's name, as the heading says it. */
  provider: string;
  file: UnmatchedFile;
  number?: number;
  group?: number;
  /** For a season, only that season's files. */
  siblings?: Sibling[];
  tracks?: ReleaseTracks;
  selected: ReadonlySet<string>;
  statuses: Readonly<Record<string, FileStatus>>;
  disabled: boolean;
  onSelect: (selected: Set<string>) => void;
}) {
  const of = set === 'album' ? 'this album' : 'this season';
  if (siblings === undefined) return <Waiting>{`Looking for other unmatched files of ${of} in this folder…`}</Waiting>;
  const choosable = (sibling: Sibling) => sibling.number != null && onRelease(tracks, sibling.number, sibling.group) !== null;
  const numbered = siblings.filter(choosable);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id); else next.delete(id);
    onSelect(next);
  };
  const row = (id: string, name: string, number: number | undefined, group: number | undefined, checkbox: ReactNode, status?: FileStatus) => (
    <tr key={id} className={typeof status === 'object' ? 'identify-album-left' : undefined}>
      <td>{checkbox}</td>
      <td className="identify-album-file">{name}</td>
      <td className={set === 'album' && onRelease(tracks, number, group) === null ? 'identify-album-missing' : undefined}>{`${record.title} · ${placeText(set, tracks, number, group)}`}</td>
      <td className="identify-album-status">{statusText(status)}</td>
    </tr>
  );
  return (
    <div className="identify-album-files">
      <div className="identify-album-heading">
        <span>{siblings.length === 0 ? `No other unmatched files of ${of} in this folder.` : `Files in this folder, and their ${provider} match`}</span>
        {numbered.length > 0 && (
          <span className="identify-actions">
            <button className="secondary-button" type="button" disabled={disabled} onClick={() => onSelect(new Set(numbered.map((sibling) => sibling.file.id)))} data-tv-focusable="true">Select all</button>
            <button className="secondary-button" type="button" disabled={disabled} onClick={() => onSelect(new Set())} data-tv-focusable="true">Select none</button>
          </span>
        )}
      </div>
      {set === 'album' && tracks === undefined && <Waiting>Reading the release's track titles…</Waiting>}
      {tracks && !Array.isArray(tracks) && <p className="manage-error">The release's track titles could not be read: {tracks.unread}</p>}
      <table>
        <tbody>
          {row(file.id, `${fileName(file.path)} (this file)`, number, group,
            <input type="checkbox" checked disabled aria-label={`${fileName(file.path)}, always matched`} />, statuses[file.id])}
          {siblings.map((sibling) => {
            const name = fileName(sibling.file.path);
            return row(sibling.file.id, name, sibling.number, sibling.group, (
              <input
                type="checkbox"
                checked={selected.has(sibling.file.id)}
                disabled={disabled || !choosable(sibling)}
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
