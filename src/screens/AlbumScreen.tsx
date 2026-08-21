import type { MediaApi } from '../api/MediaApi';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useAsync } from '../hooks/useAsync';
import type { AlbumDetails, MediaSummary } from '../types';
import { EditButton } from '../components/EditButton';

interface Props {
  api: MediaApi;
  albumId: string;
  onBack: () => void;
  onPlayTrack: (track: MediaSummary, queue: MediaSummary[], queueIndex: number) => void;
  onEdit?: () => void;
}

export function AlbumScreen({ api, albumId, onBack, onPlayTrack, onEdit }: Props) {
  const details = useAsync(() => api.details(albumId), [api, albumId]);
  const album = details.value?.kind === 'album' && 'tracks' in details.value
    ? details.value as AlbumDetails
    : undefined;
  const cover = useArtworkUrl(api, album?.artwork?.poster ?? album?.artwork?.thumbnail);

  if (details.loading) return <Loading />;
  if (details.error) return <ErrorMessage error={details.error} />;
  if (!album) return <ErrorMessage error={new Error('Catalogue item is not an album.')} />;

  return (
    <section className="album-page">
      <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Music</button>
      {onEdit && <EditButton onClick={onEdit} />}
      <div className="album-header">
        <div className="album-cover">
          {cover ? <img src={cover} alt="" /> : <div className="poster-placeholder">{album.title.slice(0, 1)}</div>}
        </div>
        <div>
          <p className="eyebrow">Album{album.year ? ` · ${album.year}` : ''}</p>
          <h1>{album.title}</h1>
          {album.synopsis && <p className="synopsis">{album.synopsis}</p>}
        </div>
      </div>
      <div className="track-list" aria-label="Tracks">
        {album.tracks.map((track, index) => (
          <button
            key={track.id}
            className="track-row"
            data-tv-focusable="true"
            type="button"
            onClick={() => onPlayTrack(track, album.tracks, index)}
          >
            <span className="track-number">{track.trackNumber ?? '–'}</span>
            <span className="track-title">{track.title}</span>
            <span className="track-action">▶</span>
          </button>
        ))}
      </div>
    </section>
  );
}
