import type {
  PlaybackDecisionReason,
  PlaybackInstructionReport,
  PlaybackPreferencesUpdate,
  PlaybackSession,
  PlaybackStreamInfo,
  PlaybackUpdate,
} from '@machafoundation/core';
import type { PlaybackCapabilities, PlaybackMode } from '@machafoundation/core';
import { useEffect, useRef } from 'react';
import type { PlayerNodeChoice } from './nodeChoices';
import { modeRequest } from './modeTransforms';

function streamLabel(stream: PlaybackStreamInfo, fallback: string): string {
  const parts = [stream.language ? stream.language.toUpperCase() : fallback, stream.codec.toUpperCase()];
  if (stream.channels) parts.push(`${stream.channels}ch`);
  if (stream.forced) parts.push('forced');
  return parts.join(' · ');
}

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
 * Why the facts lookup failed, in one clause, or nothing.
 *
 * `factsError` is `unknown` by contract — it is whatever the facts supplier
 * threw — so nothing here assumes a shape. An absent error is not a failure to
 * describe: core states that it is absent when there is no facts supplier at
 * all, which is a configuration rather than a fault, and inventing a sentence
 * for it would report a problem nobody has.
 */
function describeFactsError(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) return undefined;
  const message = cause instanceof Error ? cause.message : String(cause);
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed.replace(/\.$/, '') : undefined;
}

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
  if (instruction.withoutFacts) {
    // Say *why* nothing could be read, from server 0.12.0's `factsError`. A
    // viewer who sees "could not be reasoned from" has no idea whether their
    // file is broken, their node is busy or this client never asked — and the
    // symptom they get downstream is a media error that reads as a corrupt
    // download. `factsError` is deliberately `unknown`, because it is whatever
    // the supplier threw, so it is described rather than trusted.
    const cause = describeFactsError(instruction.factsError);
    return cause
      ? `Chosen without facts — transcoding because this file's details could not be read: ${cause}`
      : 'Chosen without facts — transcoding because nothing could be reasoned from.';
  }
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

export function PlayerOptions({ session, pendingPreferences, instruction, capabilities, nodes = [], movingToNode, onApply, onSelectNode }: {
  session: PlaybackSession;
  /** What this device can actually decode, which decides what remux may copy. */
  capabilities?: PlaybackCapabilities;
  pendingPreferences?: PlaybackPreferencesUpdate;
  instruction?: PlaybackInstructionReport;
  /** Every node this client knows, already in a stable display order. */
  nodes?: readonly PlayerNodeChoice[];
  /** The node a move is in flight to, so the pill can say so rather than look ignored. */
  movingToNode?: string;
  onApply: (update: PlaybackUpdate) => void;
  onSelectNode?: (nodeId: string) => void;
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
  // they did not make. Saying the whole transform outright leaves nothing to
  // be merged with, and nothing to disagree about.
  //
  // What it says is `modeTransform`'s to decide, and remux is the one that
  // has a decision: copying audio this device cannot decode is how a mode
  // press turned into a node that never produced a first fragment. See there
  // for the measurement.
  const audioCodec = session.options.audioStreams.find((stream) => stream.index === selectedAudio)?.codec
    ?? session.output.audio?.codec;
  const mode = (value: PlaybackMode | 'choose') => onApply({
    preferences: value === 'choose' ? { mode: value } : modeRequest(value, audioCodec, capabilities),
  });
  const chosenByViewer = effectivePreferences.mode !== undefined && effectivePreferences.mode !== 'choose';
  // With dozens of nodes the one you are on can be off the bottom of its own
  // list, which reads as no node being selected at all.
  const activeNodeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeNodeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [nodes]);
  const preferences = (update: PlaybackPreferencesUpdate) => onApply({ preferences: update });

  return (
    <div className="player-options" aria-label="Playback options">
      <div className="player-options-controls">
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

      {/* Right-hand side, unlike everything above it, and that placement is
          the point: the format controls change what the node sends, this
          changes which node sends it. It is also where the node already
          appears — the `CONTAINER : origin` line in the title bar is
          right-aligned, so the answer and the control that changes it sit on
          the same edge. */}
      {onSelectNode && nodes.length > 1 && <div className="player-option-group player-option-group-node">
        <span>Node</span>
        <div>
          {nodes.map((node) => (
            <button
              type="button"
              key={node.id}
              ref={node.active ? activeNodeRef : undefined}
              data-tv-focusable="true"
              className={node.active ? 'selected' : undefined}
              title={node.detail}
              disabled={node.active || node.id === movingToNode}
              onClick={() => onSelectNode(node.id)}
            >
              {node.label}
            </button>
          ))}
        </div>
        <small className="player-option-note">
          {movingToNode
            ? 'Moving this stream to the node you picked, from where you are now…'
            : 'Plays from the node you pick, at the position you are at. Recovery still moves you off a node that fails.'}
        </small>
      </div>}
    </div>
  );
}
