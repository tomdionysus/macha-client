import type { PlaybackCapabilities, PlaybackMode } from '@machafoundation/core';

export interface ModeRequest {
  mode: PlaybackMode;
  video: 'copy' | 'transcode';
  audio: 'copy' | 'transcode';
}

/** `E-AC-3`, `eac3` and `EAC-3` are one codec. */
function normalise(codec: string): string {
  return codec.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Whether this device can decode that audio through HLS delivery, which remux
 * uses. An unstated `hlsAudioCodecs` falls back to the general list.
 */
function decodableOverHls(capabilities: PlaybackCapabilities | undefined, codec: string | undefined): boolean {
  if (!capabilities || codec === undefined || codec === '') return false;
  const usable = capabilities.hlsAudioCodecs ?? capabilities.audioCodecs;
  return usable.some((candidate) => normalise(candidate) === normalise(codec));
}

/**
 * What a mode press asks the server for. The server refuses `mode=remux` with
 * `audio=transcode`, so a remux whose audio this device cannot decode over HLS
 * becomes a transcode that copies the video; copied, it would stall or play silent.
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
