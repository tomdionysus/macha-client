const segment = (value) => encodeURIComponent(value);
export const routes = {
    home: '/',
    movies: '/movies',
    movie: (id) => `/movies/${segment(id)}`,
    series: '/series',
    show: (id) => `/series/${segment(id)}`,
    season: (showId, seasonId) => `/series/${segment(showId)}/seasons/${segment(seasonId)}`,
    episode: (id) => `/episodes/${segment(id)}`,
    music: '/music',
    musicArtists: '/music/artists',
    musicAlbums: '/music/albums',
    musicTracks: '/music/tracks',
    musicPlaylist: '/music/playlist',
    artist: (id) => `/music/artists/${segment(id)}`,
    album: (id) => `/music/albums/${segment(id)}`,
    track: (id) => `/music/tracks/${segment(id)}`,
    player: (id) => `/play/${segment(id)}`,
    playerFromStart: (id) => `/play/${segment(id)}?start=0`,
    item: (id) => `/items/${segment(id)}`,
    edit: (id) => `/items/${segment(id)}/edit`,
    search: '/search',
    ingest: '/ingest',
    settings: '/settings',
    sponsor: '/sponsor',
};
export function pathForMedia(item) {
    switch (item.kind) {
        case 'movie':
            return routes.movie(item.id);
        case 'show':
            return routes.show(item.id);
        case 'season':
            return item.parentId ? routes.season(item.parentId, item.id) : routes.item(item.id);
        case 'episode':
            return routes.episode(item.id);
        case 'artist':
            return routes.artist(item.id);
        case 'album':
            return routes.album(item.id);
        case 'track':
            return routes.track(item.id);
        default:
            return routes.item(item.id);
    }
}
