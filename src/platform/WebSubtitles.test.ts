import { describe, expect, it } from 'vitest';
import {
  subtitleSegmentAt,
  subtitleSegmentStarts,
  subtitleSegmentWindow,
  validSubtitleManifest,
} from './WebSubtitles';

describe('segmented WebVTT policy', () => {
  it('validates the server manifest contract', () => {
    expect(validSubtitleManifest({
      format: 'macha-webvtt-segments', version: 1, stream_index: 2, segment_durations_ms: [10_000, 20_000],
    })).toBe(true);
    expect(validSubtitleManifest({
      format: 'macha-webvtt-segments', version: 1, stream_index: 2, segment_durations_ms: [10_000, 0],
    })).toBe(false);
  });

  it('selects the segment spanning the current playback position', () => {
    const starts = subtitleSegmentStarts([10_000, 20_000, 5_000]);
    expect(starts).toEqual([0, 10_000, 30_000]);
    expect(subtitleSegmentAt(starts, -1)).toBe(0);
    expect(subtitleSegmentAt(starts, 9_999)).toBe(0);
    expect(subtitleSegmentAt(starts, 10_000)).toBe(1);
    expect(subtitleSegmentAt(starts, 35_000)).toBe(2);
  });

  it('retains the previous segment and preloads the next within bounds', () => {
    expect(subtitleSegmentWindow(0, 4)).toEqual([0, 1]);
    expect(subtitleSegmentWindow(2, 4)).toEqual([1, 2, 3]);
    expect(subtitleSegmentWindow(3, 4)).toEqual([2, 3]);
  });
});
