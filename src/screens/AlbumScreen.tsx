import type { MediaApi } from '../api/MediaApi';
import { OverflowMenu, type OverflowMenuAction } from '../components/OverflowMenu';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useRefreshableAsync } from '../hooks/useRefreshableAsync';
import type { AlbumDetails, MediaSummary } from '../types';
import { EditButton } from '../components/EditButton';
import { MediaPageTitle } from '../components/MediaPageTitle';

interface Props {
  api: MediaApi;
  albumId: string;
  onBack: () => void;
  onPlayTrack: (track: MediaSummary, queue: MediaSummary[], queueIndex: number) => void;
  onPlayAll: (album: MediaSummary) => void;
  onOpenTrack: (track: MediaSummary) => void;
  onAddToPlaylist: (item: MediaSummary) => void;
  onPlayNext: (item: MediaSummary) => void;
  onPlayLater: (item: MediaSummary) => void;
  onShuffle: (item: MediaSummary) => void;
  onEdit?: () => void;
}

export function AlbumScreen({ api, albumId, onBack, onPlayTrack, onPlayAll, onOpenTrack, onAddToPlaylist, onPlayNext, onPlayLater, onShuffle, onEdit }: Props) {
  const details = useRefreshableAsync(() => api.details(albumId), [api, albumId]);
  const album = details.value?.kind === 'album' && 'tracks' in details.value
    ? details.value as AlbumDetails
    : undefined;
  const cover = useArtworkUrl(api, album?.artwork?.poster ?? album?.artwork?.thumbnail);

  if (!details.value) return <section className="album-page">
    <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Music</button>
    <MediaPageTitle refreshing={details.refreshing} onRefresh={details.refresh}>Album</MediaPageTitle>
    {details.loading ? <Loading /> : details.error ? <ErrorMessage error={details.error} /> : null}
  </section>;
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
          <MediaPageTitle refreshing={details.refreshing} onRefresh={details.refresh}>{album.title}</MediaPageTitle>
          {details.error && <p className="manage-error media-refresh-error">Refresh failed: {details.error.message}</p>}
          {album.synopsis && <p className="synopsis">{album.synopsis}</p>}
          <div className="play-actions album-actions">
            <button className="primary-button" type="button" data-tv-focusable="true" disabled={album.tracks.length === 0} onClick={() => onPlayAll(album)}>▶ Play all</button>
            <button className="secondary-button" type="button" data-tv-focusable="true" disabled={album.tracks.length === 0} onClick={() => onShuffle(album)}>Shuffle</button>
            <button className="secondary-button" type="button" data-tv-focusable="true" disabled={album.tracks.length === 0} onClick={() => onAddToPlaylist(album)}>Add to playlist</button>
            <OverflowMenu
              className="inline-overflow-menu"
              label={`More options for ${album.title}`}
              actions={[
                { label: 'Play next', onSelect: () => onPlayNext(album), disabled: album.tracks.length === 0 },
                { label: 'Play later', onSelect: () => onPlayLater(album), disabled: album.tracks.length === 0 },
              ]}
            />
          </div>
        </div>
      </div>
      <div className="track-list" aria-label="Tracks">
        {album.tracks.map((track, index) => {
          const actions: OverflowMenuAction[] = [
            { label: 'Add track to playlist', onSelect: () => onAddToPlaylist(track) },
            { label: 'Play next', onSelect: () => onPlayNext(track) },
            { label: 'Play later', onSelect: () => onPlayLater(track) },
            { label: 'View track', onSelect: () => onOpenTrack(track) },
          ];
          return (
            <div key={track.id} className="track-row">
              <button
                className="track-row-open"
                data-tv-focusable="true"
                type="button"
                onClick={() => onPlayTrack(track, album.tracks, index)}
              >
                <span className="track-number">{track.trackNumber ?? '–'}</span>
                <span className="track-title">{track.title}</span>
                <span className="track-action">▶</span>
              </button>
              <OverflowMenu className="track-overflow-menu" label={`More options for ${track.title}`} actions={actions} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
