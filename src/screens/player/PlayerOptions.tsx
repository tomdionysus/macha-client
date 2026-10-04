import { qualityLabel } from '@machafoundation/core';
import type {
  OfferedMode,
  PlaybackDecisionReason,
  PlaybackInstructionReport,
  PlaybackPreferencesUpdate,
  PlaybackSession,
  PlaybackStreamInfo,
  PlaybackUpdate,
  PlaybackVersions,
  VersionStep,
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
  'video-size-exceeds-client': 'the picture is larger than this device plays',
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
  'player-could-not-decode': 'this device could not decode the copied streams',
  'transcode-below-real-time': 'the server cannot convert this picture fast enough to play',
};

/** Why the facts lookup failed, in one clause. `factsError` is whatever the supplier threw, so no shape is assumed; absent means no supplier, not a fault. */
function describeFactsError(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) return undefined;
  const message = cause instanceof Error ? cause.message : String(cause);
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed.replace(/\.$/, '') : undefined;
}

/**
 * Why this stream is served the way it is. A failed facts lookup falls back to
 * transcode, which plays, so this note is the only place that failure shows.
 */
function instructionNote(instruction: PlaybackInstructionReport | undefined): string | undefined {
  if (!instruction) return undefined;
  if (instruction.chosenByViewer) return 'Chosen by you.';
  if (instruction.withoutFacts) {
    // Say why nothing could be read, so the viewer can tell a broken file from a busy node.
    const cause = describeFactsError(instruction.factsError);
    return cause
      ? `Chosen without facts — transcoding because this file's details could not be read: ${cause}`
      : 'Chosen without facts — transcoding because nothing could be reasoned from.';
  }
  const reasons = instruction.reasons.map((reason) => REASON_TEXT[reason] ?? reason);
  return reasons.length > 0 ? `Chosen automatically: ${reasons.join('; ')}.` : 'Chosen automatically.';
}

/** Inputs nobody supplied to the chooser. This client intends to wire them all, so any listed is a defect. */
function assumptionNote(instruction: PlaybackInstructionReport | undefined): string | undefined {
  if (!instruction || instruction.chosenByViewer || instruction.assumed.length === 0) return undefined;
  return `Decided without: ${instruction.assumed.join(', ')}.`;
}

export function PlayerOptions({ session, pendingPreferences, instruction, capabilities, versions, offered, nodes = [], movingToNode, onApply, onPlayVersion, onSelectNode }: {
  session: PlaybackSession;
  /**
  /**
   * Core's `offeredModes`. A mode not offered is hidden; one offered only because
   * the viewer asked for everything says why the device objects. Absent shows every mode the node allows.
   */
  offered?: readonly OfferedMode[];
  /** The item's qualities, as on its detail page; see core's `snapshot.versions`. */
  versions?: PlaybackVersions;
  onPlayVersion?: (step: VersionStep) => void;
  /** What this device decodes, which decides what remux may copy. */
  capabilities?: PlaybackCapabilities;
  pendingPreferences?: PlaybackPreferencesUpdate;
  instruction?: PlaybackInstructionReport;
  /** Every node this client knows, in display order. */
  nodes?: readonly PlayerNodeChoice[];
  /** The node a move is in flight to. */
  movingToNode?: string;
  onApply: (update: PlaybackUpdate) => void;
  onSelectNode?: (nodeId: string) => void;
}) {
  const effectivePreferences = { ...session.preferences, ...pendingPreferences };
  const selectedAudio = pendingPreferences?.audioStream ?? session.selected.audioStream;
  const selectedSubtitle = pendingPreferences?.subtitleStream === null
    ? -1
    : pendingPreferences?.subtitleStream ?? session.selected.subtitleStream;
  // `'choose'` (Auto) is a core sentinel that never reaches the wire: the
  // coordinator re-runs the chooser and sends a concrete mode. A concrete mode
  // press states the whole transform (`modeRequest`), because naming only the
  // mode leaves the session's per-stream transforms in place and the server
  // refuses the contradiction.
  const audioCodec = session.options.audioStreams.find((stream) => stream.index === selectedAudio)?.codec
    ?? session.output.audio?.codec;
  const mode = (value: PlaybackMode | 'choose') => onApply({
    preferences: value === 'choose' ? { mode: value } : modeRequest(value, audioCodec, capabilities),
  });
  const chosenByViewer = effectivePreferences.mode !== undefined && effectivePreferences.mode !== 'choose';
  // Keeps the active node in view in a long list.
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
          {session.options.modes.map((candidate) => {
            const offer = offered?.find((entry) => entry.mode === candidate);
            if (offer && !offer.offered) return null;
            const objection = offer && offer.reasons.length > 0
              ? `This device may not play this: ${offer.reasons.map((reason) => REASON_TEXT[reason] ?? reason).join('; ')}.`
              : undefined;
            return (
              <button type="button" key={candidate} data-tv-focusable="true" className={effectivePreferences.mode === candidate ? 'selected' : undefined} title={objection} onClick={() => mode(candidate)}>
                {candidate === 'direct' ? 'Direct' : candidate === 'remux' ? 'Remux' : 'Transcode'}
              </button>
            );
          })}
        </div>
        {instructionNote(instruction) && <small className={instruction?.withoutFacts ? 'player-option-note player-option-warning' : 'player-option-note'}>
          {instructionNote(instruction)}
        </small>}
        {assumptionNote(instruction) && <small className="player-option-note player-option-warning">
          {assumptionNote(instruction)}
        </small>}
      </div>

      {versions && versions.steps.length > 0 && onPlayVersion ? <div className="player-option-group">
        <span>Quality</span>
        <div>
          {versions.steps.map((step) => <button type="button" key={step.quality} data-tv-focusable="true" className={instruction?.quality === step.quality ? 'selected' : undefined} onClick={() => onPlayVersion(step)}>{qualityLabel(step.quality)}</button>)}
        </div>
      </div> : session.options.canChangeQuality && <div className="player-option-group">
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

      {/* On the right, where the title bar already names the node: this changes which node sends, not what is sent. */}
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
