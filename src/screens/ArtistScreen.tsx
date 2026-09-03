import type { MediaApi } from '../api/MediaApi';
import { MediaCard, type MediaCardAction } from '../components/MediaCard';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useRefreshableAsync } from '../hooks/useRefreshableAsync';
import type { ArtistDetails, MediaSummary } from '../types';
import { EditButton } from '../components/EditButton';
import { MediaPageTitle } from '../components/MediaPageTitle';

interface Props {
  api: MediaApi;
  artistId: string;
  onBack: () => void;
  onOpenAlbum: (album: MediaSummary) => void;
  onAddToPlaylist: (album: MediaSummary) => void;
  onPlayNext: (album: MediaSummary) => void;
  onPlayLater: (album: MediaSummary) => void;
  onShuffle: (album: MediaSummary) => void;
  onEdit?: () => void;
}

export function ArtistScreen({ api, artistId, onBack, onOpenAlbum, onAddToPlaylist, onPlayNext, onPlayLater, onShuffle, onEdit }: Props) {
  const details = useRefreshableAsync(() => api.details(artistId), [api, artistId]);
  const artist = details.value?.kind === 'artist' && 'albums' in details.value
    ? details.value as ArtistDetails
    : undefined;
  const backdrop = useArtworkUrl(api, artist?.artwork?.backdrop ?? artist?.artwork?.poster);

  if (!details.value) return <section className="detail music-detail"><div className="detail-content series-content">
    <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Music</button>
    <MediaPageTitle refreshing={details.refreshing} onRefresh={details.refresh}>Artist</MediaPageTitle>
    {details.loading ? <Loading /> : details.error ? <ErrorMessage error={details.error} /> : null}
  </div></section>;
  if (!artist) return <ErrorMessage error={new Error('Catalogue item is not an artist.')} />;

  const albumActions: MediaCardAction[] = [
    { label: 'Add album to playlist', onSelect: onAddToPlaylist },
    { label: 'Shuffle', onSelect: onShuffle },
    { label: 'Play next', onSelect: onPlayNext },
    { label: 'Play later', onSelect: onPlayLater },
    { label: 'View album', onSelect: onOpenAlbum },
  ];

  return (
    <section className="detail music-detail">
      {backdrop && <div className="detail-backdrop" style={{ backgroundImage: `url(${JSON.stringify(backdrop)})` }} />}
      <div className="detail-content series-content">
        <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Music</button>
        {onEdit && <EditButton onClick={onEdit} />}
        <p className="eyebrow">Artist</p>
        <MediaPageTitle refreshing={details.refreshing} onRefresh={details.refresh}>{artist.title}</MediaPageTitle>
        {details.error && <p className="manage-error media-refresh-error">Refresh failed: {details.error.message}</p>}
        {artist.synopsis && <p className="synopsis">{artist.synopsis}</p>}
        <h2>Albums</h2>
        <div className="media-grid">
          {artist.albums.map((album) => (
            <MediaCard
              key={album.id}
              api={api}
              item={album}
              onOpen={onOpenAlbum}
              actions={albumActions}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
