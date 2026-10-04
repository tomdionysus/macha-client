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
  // A generation's media clock cannot begin before the generation does. Refuse
  // a negative origin and stay unestablished, or every later mapping runs
  // ahead of the picture.
  return candidateMs < 0 ? undefined : candidateMs;
}

/**
 * Where the loader was pointed when the generation started fetching; the
 * timeline cannot infer it from the requested position.
 *
 * - `generation-start`: hls.js loads from the generation's beginning and is
 *   sampled before it seeks, so the first resident timestamp is the origin.
 * - `requested-position`: `attachHls` sets `startPosition`, so `currentTime`
 *   is the requested position and the origin is the difference.
 */
export type WebMediaLoaderStart = 'generation-start' | 'requested-position';

/**
 * Maps the browser media clock, whose origin MSE/HLS may inherit from the
 * source, onto the generation-local clock Player requires.
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

    // The first resident timestamp is the origin, zero-based or not.
    if (this.loaderStart === 'generation-start') {
      this.originMs = canonicalOrigin(residency[0].startMs);
      return;
    }

    // Once the requested position is resident, `currentTime` is it and the difference is the origin.
    if (Number.isFinite(rawPositionMs) && containsPosition(residency, rawPositionMs)) {
      this.originMs = canonicalOrigin(rawPositionMs - this.requestedPositionMs);
    }
  }
}
