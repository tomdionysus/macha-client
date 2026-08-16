import type { MediaApi } from '../api/MediaApi';
import type { PlaybackProgress } from '../types';

export function needsEpisodeContextMigration(entry: PlaybackProgress): boolean {
  return entry.media?.kind === 'episode' && !entry.media.playbackContext;
}

export async function migrateEpisodeContext(
  api: MediaApi,
  entry: PlaybackProgress,
): Promise<PlaybackProgress> {
  const media = entry.media;
  if (!media || media.kind !== 'episode' || media.playbackContext) return entry;
  if (!media.parentId) {
    throw new Error(`Legacy Continue Watching episode ${entry.mediaId} has no season parent id.`);
  }

  const season = await api.details(media.parentId);
  if (season.kind !== 'season') {
    throw new Error(`Legacy Continue Watching episode ${entry.mediaId} parent ${media.parentId} is not a season.`);
  }

  const seriesId = season.parentId || ('showId' in season ? season.showId : undefined);
  if (!seriesId) {
    throw new Error(`Legacy Continue Watching season ${season.id} has no series parent id.`);
  }

  const seasonNumber = season.seasonNumber ?? media.seasonNumber;
  if (seasonNumber === undefined) {
    throw new Error(`Legacy Continue Watching season ${season.id} has no season number.`);
  }

  const series = await api.details(seriesId);
  if (series.kind !== 'show') {
    throw new Error(`Legacy Continue Watching season ${season.id} parent ${seriesId} is not a series.`);
  }

  return {
    ...entry,
    media: {
      ...media,
      playbackContext: {
        series: { id: series.id, title: series.title },
        season: {
          id: season.id,
          title: season.title,
          seasonNumber,
        },
      },
    },
  };
}
