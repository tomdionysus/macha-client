import { NavLink } from 'react-router-dom';
import { routes } from '../routing';

const items = [
  { to: routes.musicArtists, label: 'Artists' },
  { to: routes.musicAlbums, label: 'Albums' },
  { to: routes.musicTracks, label: 'Tracks' },
  { to: routes.musicPlaylist, label: 'Playlist' },
] as const;

export function MusicNav() {
  return (
    <nav className="music-subnav" aria-label="Music navigation">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          data-tv-focusable="true"
          className={({ isActive }: { isActive: boolean }) => isActive ? 'active' : undefined}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
