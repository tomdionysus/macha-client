import { describe, expect, it } from 'vitest';
import type { CatalogueMediaProfile } from '@macha/core';
import { mediaProfileSummary } from './DetailScreen';

describe('mediaProfileSummary', () => {
  it('presents immutable playback facts compactly without path-derived data', () => {
    const profile: CatalogueMediaProfile = {
      schema_version: 1,
      media_id: 'macha:immutable',
      format: 'mov,mp4,m4a,3gp,3g2,mj2',
      duration_ms: 5_876_036,
      bitrate: 4_474_649,
      streams: [
        { index: 0, type: 'video', codec: 'h264', profile: 'High', language: 'und', width: 1920, height: 1040, channels: 0, sample_rate: 0, bit_depth: 8, default: true, forced: false, bitrate: 3_554_235, attached_picture: false },
        { index: 1, type: 'audio', codec: 'aac', profile: 'LC', language: 'eng', width: 0, height: 0, channels: 2, sample_rate: 48_000, bit_depth: 0, default: true, forced: false, bitrate: 127_969, attached_picture: false },
      ],
    };

    expect(mediaProfileSummary(profile)).toBe('1h 37m · 1920×1040 · H.264 · AAC · 4.5 Mbps');
  });
});
