import { describe, expect, it } from 'vitest';
import { WebMediaTimeline } from './WebMediaTimeline';

describe('WebMediaTimeline', () => {
  it('keeps Direct Play on the browser media clock', () => {
    const timeline = new WebMediaTimeline('direct', 30_000);
    const sample = timeline.sample({
      positionMs: 30_000,
      bufferedRangesMs: [{ startMs: 0, endMs: 90_000 }],
    });

    expect(sample).toEqual({
      positionMs: 30_000,
      bufferedRangesMs: [{ startMs: 0, endMs: 90_000 }],
      originMs: 0,
    });
    expect(timeline.toMediaTime(45_000)).toBe(45_000);
  });

  it('normalizes a transformed generation whose MSE timeline preserves an absolute timestamp origin', () => {
    const timeline = new WebMediaTimeline('transcode', 0);
    const sample = timeline.sample({
      positionMs: 302_000,
      bufferedRangesMs: [{ startMs: 300_000, endMs: 360_000 }],
    });

    expect(sample).toEqual({
      positionMs: 2_000,
      bufferedRangesMs: [{ startMs: 0, endMs: 60_000 }],
      originMs: 300_000,
    });
    expect(timeline.toMediaTime(20_000)).toBe(320_000);
  });

  it('leaves an ordinary zero-based transformed generation unchanged', () => {
    const timeline = new WebMediaTimeline('remux', 0);
    const sample = timeline.sample({
      positionMs: 2_000,
      bufferedRangesMs: [{ startMs: 0, endMs: 60_000 }],
    });

    expect(sample).toEqual({
      positionMs: 2_000,
      bufferedRangesMs: [{ startMs: 0, endMs: 60_000 }],
      originMs: 0,
    });
  });

  it('derives a non-zero origin when activation begins inside a transformed generation', () => {
    const timeline = new WebMediaTimeline('transcode', 10_000);
    const sample = timeline.sample({
      positionMs: 310_000,
      bufferedRangesMs: [{ startMs: 300_000, endMs: 370_000 }],
    });

    expect(sample).toEqual({
      positionMs: 10_000,
      bufferedRangesMs: [{ startMs: 0, endMs: 70_000 }],
      originMs: 300_000,
    });
    expect(timeline.toMediaTime(25_000)).toBe(325_000);
  });

  it('does not invent an origin before transformed media residency establishes one', () => {
    const timeline = new WebMediaTimeline('transcode', 10_000);

    expect(timeline.sample({ positionMs: 0, bufferedRangesMs: [] })).toBeUndefined();
    expect(timeline.toMediaTime(10_000)).toBeUndefined();
  });
});
