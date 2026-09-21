import { describe, expect, it } from 'vitest';
import type { PlaybackCapabilities } from '@machafoundation/core';
import { modeRequest } from './modeTransforms';

function capabilities(overrides: Partial<PlaybackCapabilities> = {}): PlaybackCapabilities {
  return {
    platform: 'web',
    videoCodecs: ['h264', 'hevc'],
    audioCodecs: ['aac', 'mp3'],
    containers: ['mp4'],
    hlsFmp4: true,
    ...overrides,
  } as PlaybackCapabilities;
}

describe('modeTransform', () => {
  it('copies the audio on remux when this device can decode it', () => {
    expect(modeRequest('remux', 'aac', capabilities())).toEqual({ mode: 'remux', video: 'copy', audio: 'copy' });
  });

  it('becomes a transcode that copies the video when the audio cannot be copied', () => {
    // Not `mode: remux` with a transcoded stream: the server refuses that
    // outright — "remux repackages and copies every stream".
    expect(modeRequest('remux', 'ac3', capabilities())).toEqual({ mode: 'transcode', video: 'copy', audio: 'transcode' });
    expect(modeRequest('remux', 'eac3', capabilities())).toEqual({ mode: 'transcode', video: 'copy', audio: 'transcode' });
  });

  it('spells a codec the way the wire does, the UI does, and the table does', () => {
    const takesEac3 = capabilities({ audioCodecs: ['E-AC-3'] });
    expect(modeRequest('remux', 'eac3', takesEac3).audio).toBe('copy');
    expect(modeRequest('remux', 'EAC3', takesEac3).audio).toBe('copy');
  });

  it('never asks for a remux with a transcoded stream, which the server refuses', () => {
    const request = modeRequest('remux', 'ac3', capabilities());
    expect(request.mode === 'remux' && request.audio === 'transcode').toBe(false);
  });

  it('asks the HLS decoder rather than the element, because remux is HLS', () => {
    const elementOnly = capabilities({ audioCodecs: ['aac', 'ac3'], hlsAudioCodecs: ['aac'] });
    expect(modeRequest('remux', 'ac3', elementOnly).audio).toBe('transcode');
    expect(modeRequest('remux', 'aac', elementOnly).audio).toBe('copy');
  });

  it('transcodes rather than gambling when the codec or the capabilities are unknown', () => {
    expect(modeRequest('remux', undefined, capabilities()).audio).toBe('transcode');
    expect(modeRequest('remux', '', capabilities()).audio).toBe('transcode');
    expect(modeRequest('remux', 'aac', undefined).audio).toBe('transcode');
  });

  it('leaves direct and transcode alone, since neither has a choice to make', () => {
    expect(modeRequest('direct', 'ac3', capabilities())).toEqual({ mode: 'direct', video: 'copy', audio: 'copy' });
    expect(modeRequest('transcode', 'aac', capabilities())).toEqual({ mode: 'transcode', video: 'transcode', audio: 'transcode' });
  });
});
