import { describe, expect, it } from 'vitest';
import { detectWebMediaCodecCapabilities } from './WebMediaCapabilities';

function probeFrom(supported: readonly string[]): (mime: string) => boolean {
  const set = new Set(supported);
  return (mime) => set.has(mime);
}

describe('detectWebMediaCodecCapabilities', () => {
  it('recognises AC-3 and E-AC-3 through their fMP4 codec identifiers', () => {
    const capabilities = detectWebMediaCodecCapabilities(probeFrom([
      'video/mp4',
      'audio/mp4; codecs="ac-3"',
      'audio/mp4; codecs="ec-3"',
    ]));

    expect(capabilities.containers).toContain('mp4');
    expect(capabilities.audioCodecs).toContain('ac3');
    expect(capabilities.audioCodecs).toContain('eac3');
  });

  it('retains legacy raw Dolby MIME probes as compatibility fallbacks', () => {
    const capabilities = detectWebMediaCodecCapabilities(probeFrom([
      'audio/x-ac3',
      'audio/x-eac3',
    ]));

    expect(capabilities.audioCodecs).toEqual(['ac3', 'eac3']);
  });

  it('does not advertise Dolby codecs when no browser probe accepts them', () => {
    const capabilities = detectWebMediaCodecCapabilities(probeFrom([
      'video/mp4',
      'video/mp4; codecs="avc1.42E01E"',
      'audio/mp4; codecs="mp4a.40.2"',
    ]));

    expect(capabilities.videoCodecs).toEqual(['h264']);
    expect(capabilities.audioCodecs).toEqual(['aac']);
  });
});
