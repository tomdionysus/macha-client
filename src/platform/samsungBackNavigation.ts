import type { MediaApi } from '@machafoundation/core';
import { routes } from '@machafoundation/core';

function decoded(match: RegExpMatchArray | null, index: number): string | undefined {
  const value = match?.[index];
  if (!value) return undefined;
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Deterministic Samsung Return-key hierarchy; Home itself is handled centrally as an application exit. */
export async function samsungBackTarget(pathname: string, api: MediaApi, playerReturnTo?: string): Promise<string | undefined> {
  if (pathname === routes.home) return undefined;
  if (/^\/play\/[^/]+$/.test(pathname)) return playerReturnTo || routes.home;

  if (/^\/movies\/[^/]+$/.test(pathname)) return routes.movies;
  if (pathname === routes.movies) return routes.home;

  const season = pathname.match(/^\/series\/([^/]+)\/seasons\/([^/]+)$/);
  if (season) return routes.show(decoded(season, 1)!);
  if (/^\/series\/[^/]+$/.test(pathname)) return routes.home;
  if (pathname === routes.series) return routes.home;

  const episode = pathname.match(/^\/episodes\/([^/]+)$/);
  if (episode) {
    const episodeId = decoded(episode, 1)!;
    const details = await api.details(episodeId);
    const seasonId = details.parentId;
    if (!seasonId) return routes.series;
    const seasonDetails = await api.details(seasonId);
    const seriesId = seasonDetails.parentId || ('showId' in seasonDetails ? seasonDetails.showId : undefined);
    return seriesId ? routes.season(seriesId, seasonId) : routes.series;
  }

  if (/^\/music\/(?:artists|albums|tracks)\/[^/]+$/.test(pathname)) return routes.music;
  if (pathname === routes.music || pathname === routes.musicArtists || pathname === routes.musicAlbums
      || pathname === routes.musicTracks || pathname === routes.musicPlaylist) return routes.home;

  if (/^\/status\/nodes\/[^/]+$/.test(pathname)) return routes.status;
  if (pathname === routes.status) return routes.home;
  if (pathname === routes.manageFiles || pathname === routes.manageUsers) return routes.manage;
  if (pathname === routes.manage) return routes.home;
  // Settings is a top-level section reached from the top bar, not a page
  // under Manage, so Return leaves for Home rather than a section the viewer
  // may not even be able to see.
  if (pathname === routes.connection) return routes.settings;
  if (pathname === routes.settings) return routes.home;
  if (pathname === routes.accountPassword) return routes.account;
  if (pathname === routes.account || pathname === routes.login) return routes.home;

  return routes.home;
}
