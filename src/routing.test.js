import { describe, expect, it } from 'vitest';
import { pathForMedia, routes } from './routing';
const item = (partial) => ({
    id: 'id',
    kind: 'movie',
    title: 'Title',
    mediaIds: [],
    ...partial,
});
describe('routes', () => {
    it('uses stable browser-history paths for movies, series, music and playback', () => {
        expect(routes.movie('movie:one')).toBe('/movies/movie%3Aone');
        expect(routes.show('show:one')).toBe('/series/show%3Aone');
        expect(routes.season('show:one', 'season:1')).toBe('/series/show%3Aone/seasons/season%3A1');
        expect(routes.artist('artist:one')).toBe('/music/artists/artist%3Aone');
        expect(routes.album('album:one')).toBe('/music/albums/album%3Aone');
        expect(routes.track('track:one')).toBe('/music/tracks/track%3Aone');
        expect(routes.player('track:one')).toBe('/play/track%3Aone');
        expect(routes.playerFromStart('track:one')).toBe('/play/track%3Aone?start=0');
    });
    it('routes season catalogue items through their parent series', () => {
        expect(pathForMedia(item({ id: 'season:1', kind: 'season', parentId: 'show:one' })))
            .toBe('/series/show%3Aone/seasons/season%3A1');
    });
    it('routes music catalogue items through first-class music paths', () => {
        expect(pathForMedia(item({ id: 'artist:one', kind: 'artist' }))).toBe('/music/artists/artist%3Aone');
        expect(pathForMedia(item({ id: 'album:one', kind: 'album' }))).toBe('/music/albums/album%3Aone');
        expect(pathForMedia(item({ id: 'track:one', kind: 'track' }))).toBe('/music/tracks/track%3Aone');
    });
});
