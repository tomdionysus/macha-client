import type { PlaybackResolver } from './PlaybackResolver';
import type { MediaSummary, PlaybackCapabilities, PlaybackSource } from '../types';

export class UnavailablePlaybackResolver implements PlaybackResolver {
  readonly available = false;

  async resolve(_media: MediaSummary, _capabilities: PlaybackCapabilities): Promise<PlaybackSource> {
    throw new Error('This Macha server does not expose a playback/streaming API yet.');
  }
}
