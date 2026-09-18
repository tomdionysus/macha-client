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
    // The teardown path: hls.js loads from zero and the initial-seek listener
    // samples at `currentTime` 0 to establish the origin *before* it seeks. The
    // requested position is the server's `seek_offset_ms` into the generation,
    // and says nothing about where the media clock begins. Figures are the live
    // remux generation from 2026-09-18: an 18,120 ms offset, one fragment
    // resident, sampled at zero.
    const timeline = new WebMediaTimeline('remux', 18_120, 'generation-start');
    const sample = timeline.sample({
      positionMs: 0,
      bufferedRangesMs: [{ startMs: 0, endMs: 4_000 }],
    });

    expect(sample?.originMs).toBe(0);
    expect(sample?.positionMs).toBe(0);
    // The seek that follows must land at the offset, not at the generation's
    // own start. A negative origin sends it to zero and presents the pre-roll
    // the seek contract says is never presented.
    expect(timeline.toMediaTime(18_120)).toBe(18_120);
  });

  it('refuses an origin that would precede the generation start', () => {
    // The handover shape, sampled too early: the requested position is not
    // resident yet, so `currentTime` is still behind it and the difference is
    // negative. A generation's media clock cannot precede its own start, so
    // nothing is established and the next sample gets another go — rather than
    // the nonsense being baked into every later mapping.
    const timeline = new WebMediaTimeline('remux', 18_120, 'requested-position');

    expect(timeline.sample({
      positionMs: 0,
      bufferedRangesMs: [{ startMs: 0, endMs: 4_000 }],
    })).toBeUndefined();
    expect(timeline.established).toBe(false);
    expect(timeline.toMediaTime(18_120)).toBeUndefined();

    // And it establishes normally once the sample is the one the path promises.
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
