import type { MediaApi } from '../api/MediaApi';
import { MediaRow } from '../components/MediaRow';
import { ErrorMessage, Loading } from '../components/Status';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { useAsync } from '../hooks/useAsync';
import type { ArtistDetails, MediaSummary } from '../types';
import { EditButton } from '../components/EditButton';

interface Props {
  api: MediaApi;
  artistId: string;
  onBack: () => void;
  onOpenAlbum: (album: MediaSummary) => void;
  onEdit?: () => void;
}

export function ArtistScreen({ api, artistId, onBack, onOpenAlbum, onEdit }: Props) {
  const details = useAsync(() => api.details(artistId), [api, artistId]);
  const artist = details.value?.kind === 'artist' && 'albums' in details.value
    ? details.value as ArtistDetails
    : undefined;
  const backdrop = useArtworkUrl(api, artist?.artwork?.backdrop ?? artist?.artwork?.poster);

  if (details.loading) return <Loading />;
  if (details.error) return <ErrorMessage error={details.error} />;
  if (!artist) return <ErrorMessage error={new Error('Catalogue item is not an artist.')} />;

  return (
    <section className="detail music-detail">
      {backdrop && <div className="detail-backdrop" style={{ backgroundImage: `url(${JSON.stringify(backdrop)})` }} />}
      <div className="detail-content series-content">
        <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Music</button>
        {onEdit && <EditButton onClick={onEdit} />}
        <p className="eyebrow">Artist</p>
        <h1>{artist.title}</h1>
        {artist.synopsis && <p className="synopsis">{artist.synopsis}</p>}
        <MediaRow api={api} title="Albums" items={artist.albums} onOpen={onOpenAlbum} />
      </div>
    </section>
  );
}
