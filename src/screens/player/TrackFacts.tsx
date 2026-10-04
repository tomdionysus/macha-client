import type { MediaSummary } from '@machafoundation/core';
import { albumLabel, trackNumberLabel } from '../../text/viewerText';
import { MediaLine } from '../../components/MediaLine';

/** A track's artist, album and year, position and format line. A track from a saved queue may carry no music context. */
export function TrackFacts({ track, format }: { track: MediaSummary; format?: readonly string[] }) {
  const artist = track.musicContext?.artist?.title;
  const album = track.musicContext ? albumLabel(track.musicContext) : undefined;
  const position = trackNumberLabel(track);
  if (!artist && !album && !position && !format?.length) return null;
  return (
    <div className="audio-player-facts">
      {artist && <p className="audio-player-artist">{artist}</p>}
      {album && <p className="audio-player-album">{album}</p>}
      {position && <p className="audio-player-track">{position}</p>}
      {format && format.length > 0 && <MediaLine className="audio-player-format" parts={format} />}
    </div>
  );
}
