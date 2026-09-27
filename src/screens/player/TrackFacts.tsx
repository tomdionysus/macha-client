import type { MediaSummary } from '@machafoundation/core';
import { albumLabel, trackNumberLabel } from '../../text/viewerText';
import { MediaLine } from '../../components/MediaLine';

/**
 * What a track is, beside its artwork: the artist, the album with its year,
 * where it sits on the album, and its file's format line. Tom's request; the
 * format line and the place beside the artwork from 2026-09-27. A track
 * restored from a queue saved before core 0.19.0 may carry no music context;
 * it shows what it has.
 */
export function TrackFacts({ track, format }: { track: MediaSummary; format?: string }) {
  const artist = track.musicContext?.artist?.title;
  const album = track.musicContext ? albumLabel(track.musicContext) : undefined;
  const position = trackNumberLabel(track);
  if (!artist && !album && !position && !format) return null;
  return (
    <div className="audio-player-facts">
      {artist && <p className="audio-player-artist">{artist}</p>}
      {album && <p className="audio-player-album">{album}</p>}
      {position && <p className="audio-player-track">{position}</p>}
      {format && <MediaLine className="audio-player-format" line={format} />}
    </div>
  );
}
