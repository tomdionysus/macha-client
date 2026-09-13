import { describe, expect, it, vi } from 'vitest';
import { samsungBackTarget } from './samsungBackNavigation';
import type { MediaApi } from '@machafoundation/core';

const api = {
  details: vi.fn(async (id: string) => {
    if (id === 'episode') return { id, kind: 'episode', title: 'E', mediaIds: [], parentId: 'season' };
    if (id === 'season') return { id, kind: 'season', title: 'S', mediaIds: [], parentId: 'series', showId: 'series', seasonNumber: 1, episodes: [] };
    throw new Error(id);
  }),
} as unknown as MediaApi;

describe('Samsung Return hierarchy', () => {
  it('walks video hierarchy deterministically', async () => {
    await expect(samsungBackTarget('/episodes/episode', api)).resolves.toBe('/series/series/seasons/season');
    await expect(samsungBackTarget('/series/series/seasons/season', api)).resolves.toBe('/series/series');
    await expect(samsungBackTarget('/series/series', api)).resolves.toBe('/');
    await expect(samsungBackTarget('/movies/movie', api)).resolves.toBe('/movies');
    await expect(samsungBackTarget('/movies', api)).resolves.toBe('/');
  });
  it('returns music details to Music and top-level sections to Home', async () => {
    await expect(samsungBackTarget('/music/tracks/track', api)).resolves.toBe('/music');
    await expect(samsungBackTarget('/music/albums/album', api)).resolves.toBe('/music');
    await expect(samsungBackTarget('/music/artists/artist', api)).resolves.toBe('/music');
    await expect(samsungBackTarget('/music/artists', api)).resolves.toBe('/');
    await expect(samsungBackTarget('/search', api)).resolves.toBe('/');
    await expect(samsungBackTarget('/ingest', api)).resolves.toBe('/');
    await expect(samsungBackTarget('/status/nodes/node', api)).resolves.toBe('/status');
    await expect(samsungBackTarget('/status', api)).resolves.toBe('/');
    await expect(samsungBackTarget('/manage/files', api)).resolves.toBe('/manage');
    await expect(samsungBackTarget('/manage/users', api)).resolves.toBe('/manage');
    await expect(samsungBackTarget('/manage', api)).resolves.toBe('/');
    // Settings left Manage and is now reached from the top bar, so Return
    // goes Home rather than into a section a viewer may have no role for.
    await expect(samsungBackTarget('/settings', api)).resolves.toBe('/');
    await expect(samsungBackTarget('/settings/connection', api)).resolves.toBe('/settings');
    await expect(samsungBackTarget('/account', api)).resolves.toBe('/');
    await expect(samsungBackTarget('/account/password', api)).resolves.toBe('/account');
    await expect(samsungBackTarget('/login', api)).resolves.toBe('/');
    await expect(samsungBackTarget('/', api)).resolves.toBeUndefined();
  });
  it('returns the full player to its browse screen', async () => {
    await expect(samsungBackTarget('/play/episode', api, '/episodes/episode')).resolves.toBe('/episodes/episode');
  });
});
