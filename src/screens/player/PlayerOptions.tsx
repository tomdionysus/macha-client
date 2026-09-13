import type {
  PlaybackDecisionReason,
  PlaybackInstructionReport,
  PlaybackPreferencesUpdate,
  PlaybackSession,
  PlaybackStreamInfo,
  PlaybackUpdate,
} from '@machafoundation/core';
import type { PlaybackMode } from '@machafoundation/core';

function streamLabel(stream: PlaybackStreamInfo, fallback: string): string {
  const parts = [stream.language ? stream.language.toUpperCase() : fallback, stream.codec.toUpperCase()];
  if (stream.channels) parts.push(`${stream.channels}ch`);
  if (stream.forced) parts.push('forced');
  return parts.join(' · ');
}

/** What each mode means per stream, in the server's own terms. */
const MODE_TRANSFORMS: Record<PlaybackMode, { video: 'copy' | 'transcode'; audio: 'copy' | 'transcode' }> = {
  direct: { video: 'copy', audio: 'copy' },
  remux: { video: 'copy', audio: 'copy' },
  transcode: { video: 'transcode', audio: 'transcode' },
};

const REASON_TEXT: Record<PlaybackDecisionReason, string> = {
  'source-plays-as-is': 'this device plays the file as it is',
  'container-not-playable': 'this device cannot play the container',
  'video-codec-not-playable': 'this device cannot decode the video',
  'video-codec-not-deliverable-over-hls': 'the video cannot be delivered over HLS here',
  'video-bit-depth-exceeds-client': 'the video is deeper than this device decodes',
  'video-transfer-not-presentable': 'this device cannot present the colour transfer',
  'video-dolby-vision-not-supported': 'this device does not support this Dolby Vision profile',
  'audio-codec-not-playable': 'this device cannot decode the audio',
  'audio-codec-not-deliverable-over-hls': 'the audio cannot be delivered over HLS here',
  'host-policy-forbids-direct': 'this device is not trusted to play files directly',
  'host-policy-excludes-container': 'this device is not trusted with the container',
  'host-policy-excludes-codec': 'this device is not trusted with the codec',
  'host-policy-prefers-container': 'this device is served a segment format it handles better',
  'no-technical-facts': 'the server did not report what this file is',
  'executor-refused-copy': 'this server refused to copy the streams',
  'executor-cannot-direct': 'this server cannot serve the file directly',
  'executor-cannot-copy-video': 'this server cannot repackage the video',
  'executor-cannot-copy-audio': 'this server cannot repackage the audio',
};

/**
 * Why this stream is being served the way it is.
 *
 * The chooser's worst failure has no symptom without this. When the facts
 * lookup fails the coordinator falls back to transcode — the right answer,
 * since it is the only instruction always performable — and the viewer sees a
 * picture that works. So a client can quietly transcode a whole library that
 * would have direct-played, on a cluster that looks healthy, and nothing ever
 * prompts anyone to look. A television has no log a person will read; this is
 * the only place the difference can show.
 */
function instructionNote(instruction: PlaybackInstructionReport | undefined): string | undefined {
  if (!instruction) return undefined;
  if (instruction.chosenByViewer) return 'Chosen by you.';
  if (instruction.withoutFacts) return 'Chosen without facts — transcoding because nothing could be reasoned from.';
  const reasons = instruction.reasons.map((reason) => REASON_TEXT[reason] ?? reason);
  return reasons.length > 0 ? `Chosen automatically: ${reasons.join('; ')}.` : 'Chosen automatically.';
}

/**
 * Inputs nobody supplied, named rather than left to a reasonable default.
 *
 * A reasonable default produces a plausible instruction, which is why three
 * separate fields could be declared, consumed and populated by nobody without
 * anything ever looking wrong. This client intends to wire all of them, so
 * anything listed here is a defect and not a note.
 */
function assumptionNote(instruction: PlaybackInstructionReport | undefined): string | undefined {
  if (!instruction || instruction.chosenByViewer || instruction.assumed.length === 0) return undefined;
  return `Decided without: ${instruction.assumed.join(', ')}.`;
}

export function PlayerOptions({ session, pendingPreferences, instruction, onApply }: {
  session: PlaybackSession;
  pendingPreferences?: PlaybackPreferencesUpdate;
  instruction?: PlaybackInstructionReport;
  onApply: (update: PlaybackUpdate) => void;
}) {
  const effectivePreferences = { ...session.preferences, ...pendingPreferences };
  const selectedAudio = pendingPreferences?.audioStream ?? session.selected.audioStream;
  const selectedSubtitle = pendingPreferences?.subtitleStream === null
    ? -1
    : pendingPreferences?.subtitleStream ?? session.selected.subtitleStream;
  // "Auto" is no longer a value the server understands — the client decides.
  // `'choose'` is a core-side sentinel that never reaches the wire: the
  // coordinator re-runs the instruction chooser against this media's facts and
  // this platform's policy, then sends a concrete mode. Sending it on every
  // press, rather than clearing the field, is what makes Auto mean the same
  // thing mid-playback as it does at the start — an absent mode would leave
  // the server on whatever it was already doing, and the control would
  // highlight while changing nothing.
  // A mode press states the whole transform, not the shorthand for it.
  //
  // The session being amended already carries per-stream transforms from
  // whatever instruction created it — Auto's usual answer for this library is
  // transcode with the video copied — and naming only the mode leaves those in
  // place. The server then reads the result as a contradiction and refuses the
  // whole update: "direct serves the source file untouched and copies every
  // stream". The viewer pressed one button and got an error about a request
  // they did not make. Direct and remux copy both streams by definition, and
  // transcode as a viewer's explicit choice means re-encode, not re-encode
  // whatever the last instruction left alone; saying so outright leaves
  // nothing to be merged with, and nothing to disagree about.
  const mode = (value: PlaybackMode | 'choose') => onApply({
    preferences: value === 'choose' ? { mode: value } : { mode: value, ...MODE_TRANSFORMS[value] },
  });
  const chosenByViewer = effectivePreferences.mode !== undefined && effectivePreferences.mode !== 'choose';
  const preferences = (update: PlaybackPreferencesUpdate) => onApply({ preferences: update });

  return (
    <div className="player-options" aria-label="Playback options">
      <div className="player-option-group">
        <span>Mode</span>
        <div>
          <button type="button" data-tv-focusable="true" className={chosenByViewer ? undefined : 'selected'} onClick={() => mode('choose')}>Auto</button>
          {session.options.modes.map((candidate) => (
            <button type="button" key={candidate} data-tv-focusable="true" className={effectivePreferences.mode === candidate ? 'selected' : undefined} onClick={() => mode(candidate)}>
              {candidate === 'direct' ? 'Direct' : candidate === 'remux' ? 'Remux' : 'Transcode'}
            </button>
          ))}
        </div>
        {instructionNote(instruction) && <small className={instruction?.withoutFacts ? 'player-option-note player-option-warning' : 'player-option-note'}>
          {instructionNote(instruction)}
        </small>}
        {assumptionNote(instruction) && <small className="player-option-note player-option-warning">
          {assumptionNote(instruction)}
        </small>}
      </div>

      {session.options.canChangeQuality && <div className="player-option-group">
        <span>Quality</span>
        <div>
          <button type="button" data-tv-focusable="true" className={effectivePreferences.maxHeight === null && effectivePreferences.maxBitrate === null ? 'selected' : undefined} onClick={() => preferences({ maxHeight: null, maxBitrate: null })}>Original</button>
          {session.options.qualityHeights.map((height) => <button type="button" key={height} data-tv-focusable="true" className={effectivePreferences.maxHeight === height ? 'selected' : undefined} onClick={() => preferences({ maxHeight: height })}>{height}p</button>)}
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
