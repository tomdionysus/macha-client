import type { PlaybackResolver, PlaybackSession, PlaybackUpdate } from './PlaybackResolver';
import type { MediaSummary, PlaybackCapabilities } from '../types';

export class DemoPlaybackResolver implements PlaybackResolver {
  readonly available = true;
  private current?: PlaybackSession;

  async resolve(media: MediaSummary, _capabilities: PlaybackCapabilities): Promise<PlaybackSession> {
    this.current = {
      sessionId: `demo-${media.id}`,
      itemId: media.id,
      mediaId: media.mediaIds[0] ?? media.id,
      mode: 'direct',
      mimeType: 'video/mp4',
      source: {
        mediaId: media.mediaIds[0] ?? media.id,
        url: '/demo/sample.mp4',
        mimeType: 'video/mp4',
        mode: 'direct',
      },
      durationMs: media.durationMs ?? 0,
      seekMs: 0,
      preferences: {
        mode: 'auto',
        maxHeight: null,
        maxBitrate: null,
        audioStream: null,
        subtitleStream: null,
        audioLanguage: '',
        subtitleLanguage: '',
      },
      sourceInfo: { path: '/demo/sample.mp4', format: 'mp4', size: 0, bitrate: 0, streams: [] },
      output: { format: 'mp4' },
      selected: { videoStream: 0, audioStream: 1, subtitleStream: -1 },
      transform: { video: 'copy', audio: 'copy' },
      options: {
        modes: ['direct'],
        qualityHeights: [],
        mediaIds: [media.mediaIds[0] ?? media.id],
        audioStreams: [],
        subtitleStreams: [],
        canSeek: true,
        canChangeQuality: false,
        canSwitchMedia: false,
      },
    };
    return this.current;
  }

  async update(_sessionId: string, _update: PlaybackUpdate): Promise<PlaybackSession> {
    if (!this.current) throw new Error('Demo playback session is not active.');
    return this.current;
  }

  async stop(_sessionId: string): Promise<void> {
    this.current = undefined;
  }
}
