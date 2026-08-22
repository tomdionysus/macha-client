import { jsx as _jsx } from "react/jsx-runtime";
import { routes } from '../routing';
import { SectionNav } from './SectionNav';
const items = [
    { to: routes.musicArtists, label: 'Artists' },
    { to: routes.musicAlbums, label: 'Albums' },
    { to: routes.musicTracks, label: 'Tracks' },
    { to: routes.musicPlaylist, label: 'Playlist' },
];
export function MusicNav() {
    return _jsx(SectionNav, { ariaLabel: "Music navigation", items: items });
}
