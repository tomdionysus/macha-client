import type { MediaSummary, PlaybackCapabilities, PlaybackSource } from '../types';

/**
 * Server-side playback negotiation seam.
 *
 * Macha's current catalogue API does not expose media streaming. A future
 * server adapter can implement this interface without changing the React UI or
 * platform players.
 */
export interface PlaybackResolver {
  readonly available: boolean;
  resolve(media: MediaSummary, capabilities: PlaybackCapabilities): Promise<PlaybackSource>;
}
