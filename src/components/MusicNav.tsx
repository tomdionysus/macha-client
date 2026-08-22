import { routes } from '../routing';
import { SectionNav } from './SectionNav';

const items = [
  { to: routes.musicArtists, label: 'Artists' },
  { to: routes.musicAlbums, label: 'Albums' },
  { to: routes.musicTracks, label: 'Tracks' },
  { to: routes.musicPlaylist, label: 'Playlist' },
] as const;

export function MusicNav() {
  return <SectionNav ariaLabel="Music navigation" items={items} />;
}
