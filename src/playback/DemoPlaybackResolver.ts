import type { PlaybackResolver } from './PlaybackResolver';
import type { MediaSummary, PlaybackCapabilities, PlaybackSource } from '../types';

export class DemoPlaybackResolver implements PlaybackResolver {
  readonly available = true;

  async resolve(media: MediaSummary, _capabilities: PlaybackCapabilities): Promise<PlaybackSource> {
    return {
      mediaId: media.mediaIds[0] ?? media.id,
      url: '/demo/sample.mp4',
      mimeType: 'video/mp4',
      mode: 'direct',
    };
  }
}
