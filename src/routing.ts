import type { MediaSummary } from './types';

const segment = (value: string) => encodeURIComponent(value);

export const routes = {
  home: '/',
  movies: '/movies',
  movie: (id: string) => `/movies/${segment(id)}`,
  series: '/series',
  show: (id: string) => `/series/${segment(id)}`,
  season: (showId: string, seasonId: string) => `/series/${segment(showId)}/seasons/${segment(seasonId)}`,
  episode: (id: string) => `/episodes/${segment(id)}`,
  music: '/music',
  artist: (id: string) => `/music/artists/${segment(id)}`,
  album: (id: string) => `/music/albums/${segment(id)}`,
  track: (id: string) => `/music/tracks/${segment(id)}`,
  player: (id: string) => `/play/${segment(id)}`,
  playerFromStart: (id: string) => `/play/${segment(id)}?start=0`,
  item: (id: string) => `/items/${segment(id)}`,
  search: '/search',
  settings: '/settings',
} as const;

export function pathForMedia(item: MediaSummary): string {
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
