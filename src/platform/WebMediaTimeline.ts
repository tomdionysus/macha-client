import type { PlaybackMode, PlaybackTimeRange } from '@machafoundation/core';

export interface WebMediaTimelineSample {
  positionMs: number;
  bufferedRangesMs: readonly PlaybackTimeRange[];
  seekableRangesMs?: readonly PlaybackTimeRange[];
}

export interface NormalizedWebMediaTimelineSample {
  positionMs: number;
  bufferedRangesMs: PlaybackTimeRange[];
  originMs: number;
}

const ZERO_ORIGIN_TOLERANCE_MS = 250;
const RANGE_POSITION_TOLERANCE_MS = 250;

function finiteRange(range: PlaybackTimeRange): boolean {
  return Number.isFinite(range.startMs)
    && Number.isFinite(range.endMs)
    && range.endMs > range.startMs;
}

function orderedRanges(ranges: readonly PlaybackTimeRange[]): PlaybackTimeRange[] {
  return ranges
    .filter(finiteRange)
    .map((range) => ({ startMs: range.startMs, endMs: range.endMs }))
    .sort((left, right) => left.startMs - right.startMs);
}

function containsPosition(ranges: readonly PlaybackTimeRange[], positionMs: number): boolean {
  return ranges.some((range) => (
    range.startMs - RANGE_POSITION_TOLERANCE_MS <= positionMs
    && range.endMs + RANGE_POSITION_TOLERANCE_MS >= positionMs
  ));
}

function canonicalOrigin(candidateMs: number): number | undefined {
  if (!Number.isFinite(candidateMs)) return undefined;
  if (Math.abs(candidateMs) <= ZERO_ORIGIN_TOLERANCE_MS) return 0;
  // A transformed generation's media clock cannot begin before the generation
  // does. A negative candidate means the sample was not what the caller assumed
  // — so refuse it and stay unestablished rather than encode the nonsense into
  // every later mapping, which is how a readout ends up permanently ahead of
  // the picture. The next sample gets another go.
  return candidateMs < 0 ? undefined : candidateMs;
}

/**
 * Where the loader was pointed when this generation started fetching.
 *
 * The two attach paths differ in a way the timeline cannot infer from the
 * requested position, and inferring it was the fault this argument removes:
 *
 * - `generation-start` — the teardown path. hls.js loads from the beginning of
 *   the generation and the initial-seek listener samples *before* it seeks, so
 *   the first resident timestamp is the origin and `currentTime` is 0 whatever
 *   the requested position is. Under the server's seek contract that requested
 *   position is `seek_offset_ms`, which on a remux generation is routinely
 *   seconds and says nothing at all about where the media clock begins.
 * - `requested-position` — the handover path. `attachHls` sets hls.js's
 *   `startPosition`, so once metadata lands `currentTime` genuinely is the
 *   requested position and the origin is the difference.
 */
export type WebMediaLoaderStart = 'generation-start' | 'requested-position';

/**
 * Normalize the browser media clock into the source-generation-local clock
 * required by Player. MSE/HLS is allowed to expose timestamps whose origin is
 * inherited from the source media; the rest of the frontend must never need to
 * know that raw origin.
 */
export class WebMediaTimeline {
  private originMs: number | undefined;
  private readonly requestedPositionMs: number;
  private readonly transformed: boolean;
  private readonly loaderStart: WebMediaLoaderStart;

  constructor(mode: PlaybackMode, requestedPositionMs: number, loaderStart: WebMediaLoaderStart) {
    this.transformed = mode !== 'direct';
    this.requestedPositionMs = Math.max(0, Number.isFinite(requestedPositionMs) ? requestedPositionMs : 0);
    this.loaderStart = loaderStart;
    if (!this.transformed) this.originMs = 0;
  }

  get established(): boolean {
    return this.originMs !== undefined;
  }

  get mediaOriginMs(): number | undefined {
    return this.originMs;
  }

  sample(sample: WebMediaTimelineSample): NormalizedWebMediaTimelineSample | undefined {
    const buffered = orderedRanges(sample.bufferedRangesMs);
    const seekable = orderedRanges(sample.seekableRangesMs ?? []);
    this.establishOrigin(sample.positionMs, buffered, seekable);
    if (this.originMs === undefined) return undefined;

    return {
      positionMs: this.toLocalTime(sample.positionMs),
      bufferedRangesMs: buffered
        .map((range) => ({
          startMs: Math.max(0, this.toLocalTime(range.startMs)),
          endMs: Math.max(0, this.toLocalTime(range.endMs)),
        }))
        .filter((range) => range.endMs > range.startMs),
      originMs: this.originMs,
    };
  }

  toMediaTime(localPositionMs: number): number | undefined {
    if (this.originMs === undefined) return undefined;
    return Math.max(0, localPositionMs) + this.originMs;
  }

  private toLocalTime(mediaPositionMs: number): number {
    return mediaPositionMs - (this.originMs ?? 0);
  }

  private establishOrigin(
    rawPositionMs: number,
    buffered: readonly PlaybackTimeRange[],
    seekable: readonly PlaybackTimeRange[],
  ): void {
    if (this.originMs !== undefined) return;

    const residency = buffered.length > 0 ? buffered : seekable;
    if (residency.length === 0) return;

    // The loader began at the generation's own start, so the first resident
    // media timestamp is the origin. It works whether MSE exposes a zero-based
    // timeline or preserves an absolute/non-zero timestamp from the source
    // generation, and it does not care where the caller intends to seek next.
    if (this.loaderStart === 'generation-start') {
      this.originMs = canonicalOrigin(residency[0].startMs);
      return;
    }

    // The loader began at the requested position, so once that position is
    // actually resident `currentTime` is it, and the difference is the origin.
    // This maps both zero-based and non-zero MSE clocks without assuming either.
    if (Number.isFinite(rawPositionMs) && containsPosition(residency, rawPositionMs)) {
      this.originMs = canonicalOrigin(rawPositionMs - this.requestedPositionMs);
    }
  }
}
