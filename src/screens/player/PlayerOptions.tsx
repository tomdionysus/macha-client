import type {
  PlaybackPreferencesUpdate,
  PlaybackSession,
  PlaybackStreamInfo,
  PlaybackUpdate,
} from '../../playback/PlaybackResolver';
import type { PlaybackMode } from '../../types';

function streamLabel(stream: PlaybackStreamInfo, fallback: string): string {
  const parts = [stream.language ? stream.language.toUpperCase() : fallback, stream.codec.toUpperCase()];
  if (stream.channels) parts.push(`${stream.channels}ch`);
  if (stream.forced) parts.push('forced');
  return parts.join(' · ');
}

export function PlayerOptions({ session, onApply }: {
  session: PlaybackSession;
  onApply: (update: PlaybackUpdate) => void;
}) {
  const selectedAudio = session.selected.audioStream;
  const selectedSubtitle = session.selected.subtitleStream;
  const mode = (value: PlaybackMode | 'auto') => onApply({ preferences: { mode: value } });
  const preferences = (update: PlaybackPreferencesUpdate) => onApply({ preferences: update });

  return (
    <div className="player-options" aria-label="Playback options">
      <div className="player-option-group">
        <span>Mode</span>
        <div>
          <button type="button" data-tv-focusable="true" className={session.preferences.mode === 'auto' ? 'selected' : undefined} onClick={() => mode('auto')}>Auto</button>
          {session.options.modes.map((candidate) => (
            <button type="button" key={candidate} data-tv-focusable="true" className={session.preferences.mode === candidate ? 'selected' : undefined} onClick={() => mode(candidate)}>
              {candidate === 'direct' ? 'Direct' : candidate === 'remux' ? 'Remux' : 'Transcode'}
            </button>
          ))}
        </div>
      </div>

      {session.options.canChangeQuality && <div className="player-option-group">
        <span>Quality</span>
        <div>
          <button type="button" data-tv-focusable="true" className={session.preferences.maxHeight === null && session.preferences.maxBitrate === null ? 'selected' : undefined} onClick={() => preferences({ maxHeight: null, maxBitrate: null })}>Original</button>
          {session.options.qualityHeights.map((height) => <button type="button" key={height} data-tv-focusable="true" className={session.preferences.maxHeight === height ? 'selected' : undefined} onClick={() => preferences({ maxHeight: height })}>{height}p</button>)}
        </div>
      </div>}

      {session.options.audioStreams.length > 0 && <div className="player-option-group">
        <span>Audio</span>
        <div>{session.options.audioStreams.map((stream) => <button type="button" key={stream.index} data-tv-focusable="true" className={selectedAudio === stream.index ? 'selected' : undefined} onClick={() => preferences({ audioStream: stream.index, audioLanguage: '' })}>{streamLabel(stream, `Audio ${stream.index}`)}</button>)}</div>
        <small className="player-option-note">
          {session.transform.audio === 'transcode'
            ? `Server processing: transcode${session.output.audio?.codec ? ` → ${session.output.audio.codec.toUpperCase()}` : ''}`
            : session.transform.audio === 'copy' ? 'Server processing: copy' : 'Server processing: omitted'}
        </small>
      </div>}

      {session.options.subtitleStreams.length > 0 && <div className="player-option-group">
        <span>Subtitles</span>
        <div>
          <button type="button" data-tv-focusable="true" className={selectedSubtitle < 0 ? 'selected' : undefined} onClick={() => preferences({ subtitleStream: null, subtitleLanguage: '' })}>Off</button>
          {session.options.subtitleStreams.map((stream) => <button type="button" key={stream.index} data-tv-focusable="true" className={selectedSubtitle === stream.index ? 'selected' : undefined} onClick={() => preferences({ subtitleStream: stream.index, subtitleLanguage: '' })}>{streamLabel(stream, `Subtitle ${stream.index}`)}</button>)}
        </div>
      </div>}

      {session.options.canSwitchMedia && session.options.mediaIds.length > 1 && <div className="player-option-group">
        <span>Source</span>
        <div>{session.options.mediaIds.map((mediaId, index) => <button type="button" key={mediaId} data-tv-focusable="true" className={session.mediaId === mediaId ? 'selected' : undefined} title={mediaId} onClick={() => onApply({ mediaId })}>Source {index + 1}</button>)}</div>
      </div>}
    </div>
  );
}
