import type { MediaSummary } from '@machafoundation/core';
import { albumLabel, trackNumberLabel } from '../../text/viewerText';

/**
 * What a track is, under its artwork: the artist, the album with its year, and
 * where it sits on the album. Tom's request. A track restored from a queue
 * saved before core 0.19.0 may carry no music context; it shows what it has.
 */
export function TrackFacts({ track }: { track: MediaSummary }) {
  const artist = track.musicContext?.artist?.title;
  const album = track.musicContext ? albumLabel(track.musicContext) : undefined;
  const position = trackNumberLabel(track);
  if (!artist && !album && !position) return null;
  return (
    <div className="audio-player-facts">
      {artist && <p className="audio-player-artist">{artist}</p>}
      {album && <p className="audio-player-album">{album}</p>}
      {position && <p className="audio-player-track">{position}</p>}
    </div>
  );
}
