import { jsx as _jsx } from "react/jsx-runtime";
import { NavLink } from 'react-router-dom';
import { routes } from '../routing';
const items = [
    { to: routes.musicArtists, label: 'Artists' },
    { to: routes.musicAlbums, label: 'Albums' },
    { to: routes.musicTracks, label: 'Tracks' },
    { to: routes.musicPlaylist, label: 'Playlist' },
];
export function MusicNav() {
    return (_jsx("nav", { className: "music-subnav", "aria-label": "Music navigation", children: items.map((item) => (_jsx(NavLink, { to: item.to, "data-tv-focusable": "true", className: ({ isActive }) => isActive ? 'active' : undefined, children: item.label }, item.to))) }));
}
