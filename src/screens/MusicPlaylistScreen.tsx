import { useRef, type DragEvent, type KeyboardEvent } from 'react';
import type { MediaApi } from '../api/MediaApi';
import { MusicNav } from '../components/MusicNav';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import type { MusicPlaylistEntry } from '../state/musicPlaylist';

interface Props {
  api: MediaApi;
  entries: MusicPlaylistEntry[];
  onPlay: (index: number) => void;
  onShuffle: () => void;
  onRemove: (entryId: string) => void;
  onMove: (entryId: string, toIndex: number) => void;
  onClear: () => void;
}

function PlaylistArtwork({ api, entry }: { api: MediaApi; entry: MusicPlaylistEntry }) {
  const artwork = useArtworkUrl(api, entry.track.artwork?.poster ?? entry.track.artwork?.thumbnail);
  return (
    <span className="playlist-artwork" aria-hidden="true">
      {artwork ? <img src={artwork} alt="" /> : <span>{entry.track.title.slice(0, 1)}</span>}
    </span>
  );
}

export function MusicPlaylistScreen({ api, entries, onPlay, onShuffle, onRemove, onMove, onClear }: Props) {
  const draggingEntry = useRef<string | undefined>(undefined);

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, entryId: string) => {
    draggingEntry.current = entryId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', entryId);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, toIndex: number) => {
    event.preventDefault();
    const entryId = event.dataTransfer.getData('text/plain') || draggingEntry.current;
    draggingEntry.current = undefined;
    if (entryId) onMove(entryId, toIndex);
  };

  const handleReorderKey = (event: KeyboardEvent<HTMLButtonElement>, entryId: string, index: number) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    onMove(entryId, index + (event.key === 'ArrowUp' ? -1 : 1));
  };

  return (
    <section className="music-playlist-page">
      <h1>Music</h1>
      <MusicNav />
      <div className="playlist-heading-row">
        <div>
          <h2>Playlist</h2>
          <p>{entries.length === 1 ? '1 track' : `${entries.length} tracks`} · stored on this client</p>
        </div>
        <div className="playlist-actions">
          <button className="primary-button" data-tv-focusable="true" type="button" disabled={entries.length === 0} onClick={() => onPlay(0)}>▶ Play</button>
          <button className="secondary-button" data-tv-focusable="true" type="button" disabled={entries.length === 0} onClick={onShuffle}>Shuffle</button>
          <button className="secondary-button" data-tv-focusable="true" type="button" disabled={entries.length === 0} onClick={onClear}>Clear</button>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="playlist-empty">The local playlist is empty. Add tracks or albums from the Music browser.</p>
      ) : (
        <div className="playlist-track-list" aria-label="Playlist tracks">
          {entries.map((entry, index) => (
            <div
              key={entry.entryId}
              className="playlist-track-row"
              onDragOver={(event: DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event: DragEvent<HTMLDivElement>) => handleDrop(event, index)}
            >
              <button
                className="playlist-drag-handle"
                type="button"
                draggable
                data-tv-focusable="true"
                aria-label={`Reorder ${entry.track.title}. Use drag or arrow keys.`}
                title="Drag to reorder; arrow keys also move the track"
                onDragStart={(event: DragEvent<HTMLButtonElement>) => handleDragStart(event, entry.entryId)}
                onDragEnd={() => { draggingEntry.current = undefined; }}
                onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => handleReorderKey(event, entry.entryId, index)}
              >
                <span aria-hidden="true">☰</span>
              </button>
              <span className="playlist-track-number">{index + 1}</span>
              <PlaylistArtwork api={api} entry={entry} />
              <button
                className="playlist-track-copy playlist-track-play"
                type="button"
                data-tv-focusable="true"
                onClick={() => onPlay(index)}
                aria-label={`Play ${entry.track.title} now`}
              >
                <strong>{entry.track.title}</strong>
                {entry.track.subtitle && <small>{entry.track.subtitle}</small>}
              </button>
              <button
                className="playlist-remove"
                type="button"
                data-tv-focusable="true"
                aria-label={`Remove ${entry.track.title} from playlist`}
                title="Remove from playlist"
                onClick={() => onRemove(entry.entryId)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
