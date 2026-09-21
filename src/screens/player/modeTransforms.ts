import type { PlaybackCapabilities, PlaybackMode } from '@machafoundation/core';

export interface ModeRequest {
  mode: PlaybackMode;
  video: 'copy' | 'transcode';
  audio: 'copy' | 'transcode';
}

/** `E-AC-3`, `eac3`, `EAC-3` are one codec; the wire and the UI spell it three ways. */
function normalise(codec: string): string {
  return codec.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Whether this device can decode that audio **through HLS delivery**.
 *
 * `hlsAudioCodecs` rather than `audioCodecs` because the delivery decoder is
 * often not the media element's decoder, and remux means HLS. An unstated
 * `hlsAudioCodecs` means "no difference", so the general list answers.
 */
function decodableOverHls(capabilities: PlaybackCapabilities | undefined, codec: string | undefined): boolean {
  if (!capabilities || codec === undefined || codec === '') return false;
  const usable = capabilities.hlsAudioCodecs ?? capabilities.audioCodecs;
  return usable.some((candidate) => normalise(candidate) === normalise(codec));
}

/**
 * What a viewer's mode press actually asks the server for.
 *
 * **Remux copies every stream or it is not remux, and the server says so.**
 * Asked for `mode=remux` with `audio=transcode` it refuses outright: *"remux
 * repackages and copies every stream: to re-encode one, ask for
 * mode=transcode with video=copy"*. So a press that cannot copy the audio
 * has to become a transcode that copies the video — which is precisely the
 * plan the server's own chooser produces for these titles, `VIDEO COPY` plus
 * `AUDIO TRANSCODE`, and precisely what the press used to throw away.
 *
 * **Why it may not copy the audio.** Remux is delivered as fragmented MP4,
 * and this device has to decode what arrives in it. Pressing remux on an
 * AC-3 title asked a node to copy audio the browser has no decoder for, and
 * that request has two endings, both measured on 2026-09-21 against `fi-1`:
 * the node never produces a first fragment — `readyState` 0, six non-fatal
 * HLS errors then two fatal at 59 s — or, if it ever served it, a silent
 * film. The mobile client reached the same table from the other end the same
 * afternoon.
 *
 * **Direct and transcode have no decision to make.** Direct serves the source
 * file untouched, and transcode as a viewer's explicit choice means
 * re-encode, not re-encode whatever the last instruction left alone.
 */
export function modeRequest(
  pressed: PlaybackMode,
  sourceAudioCodec: string | undefined,
  capabilities: PlaybackCapabilities | undefined,
): ModeRequest {
  if (pressed === 'transcode') return { mode: 'transcode', video: 'transcode', audio: 'transcode' };
  if (pressed === 'direct') return { mode: 'direct', video: 'copy', audio: 'copy' };
  if (decodableOverHls(capabilities, sourceAudioCodec)) return { mode: 'remux', video: 'copy', audio: 'copy' };
  return { mode: 'transcode', video: 'copy', audio: 'transcode' };
}
