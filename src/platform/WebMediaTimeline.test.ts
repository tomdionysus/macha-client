import { describe, expect, it } from 'vitest';
import { WebMediaTimeline } from './WebMediaTimeline';

describe('WebMediaTimeline', () => {
  it('keeps Direct Play on the browser media clock', () => {
    const timeline = new WebMediaTimeline('direct', 30_000, 'generation-start');
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
    const timeline = new WebMediaTimeline('transcode', 0, 'generation-start');
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
    const timeline = new WebMediaTimeline('remux', 0, 'generation-start');
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
    const timeline = new WebMediaTimeline('transcode', 10_000, 'requested-position');
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

  it('takes the origin from residency when the loader began at the generation start', () => {
    // hls.js loads from zero and the origin is sampled at `currentTime` 0 before the seek. The
    // requested position is an offset into the generation, not where the media clock begins.
    const timeline = new WebMediaTimeline('remux', 18_120, 'generation-start');
    const sample = timeline.sample({
      positionMs: 0,
      bufferedRangesMs: [{ startMs: 0, endMs: 4_000 }],
    });

    expect(sample?.originMs).toBe(0);
    expect(sample?.positionMs).toBe(0);
    // The seek that follows must land at the offset; a negative origin would present the pre-roll.
    expect(timeline.toMediaTime(18_120)).toBe(18_120);
  });

  it('refuses an origin that would precede the generation start', () => {
    // Sampled before the requested position is resident, the difference is negative: nothing is
    // established and the next sample tries again.
    const timeline = new WebMediaTimeline('remux', 18_120, 'requested-position');

    expect(timeline.sample({
      positionMs: 0,
      bufferedRangesMs: [{ startMs: 0, endMs: 4_000 }],
    })).toBeUndefined();
    expect(timeline.established).toBe(false);
    expect(timeline.toMediaTime(18_120)).toBeUndefined();

    const sample = timeline.sample({
      positionMs: 318_120,
      bufferedRangesMs: [{ startMs: 300_000, endMs: 340_000 }],
    });
    expect(sample?.originMs).toBe(300_000);
  });

  it('does not invent an origin before transformed media residency establishes one', () => {
    const timeline = new WebMediaTimeline('transcode', 10_000, 'requested-position');

    expect(timeline.sample({ positionMs: 0, bufferedRangesMs: [] })).toBeUndefined();
    expect(timeline.toMediaTime(10_000)).toBeUndefined();
  });
});
