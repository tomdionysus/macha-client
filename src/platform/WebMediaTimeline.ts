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

function canonicalOrigin(candidateMs: number): number {
  if (!Number.isFinite(candidateMs)) return 0;
  return Math.abs(candidateMs) <= ZERO_ORIGIN_TOLERANCE_MS ? 0 : candidateMs;
}

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

  constructor(mode: PlaybackMode, requestedPositionMs: number) {
    this.transformed = mode !== 'direct';
    this.requestedPositionMs = Math.max(0, Number.isFinite(requestedPositionMs) ? requestedPositionMs : 0);
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

    // Most transformed generations are activated at local time zero. In that
    // case the first resident media timestamp is the strongest origin signal:
    // it works whether MSE exposes a zero-based timeline or preserves an
    // absolute/non-zero timestamp from the source generation.
    if (this.requestedPositionMs <= ZERO_ORIGIN_TOLERANCE_MS) {
      this.originMs = canonicalOrigin(residency[0].startMs);
      return;
    }

    // When activation starts within an already-open generation, currentTime is
    // the known requested local position once it is actually resident. This
    // maps both zero-based and non-zero MSE clocks without assuming either.
    if (Number.isFinite(rawPositionMs) && containsPosition(residency, rawPositionMs)) {
      this.originMs = canonicalOrigin(rawPositionMs - this.requestedPositionMs);
    }
  }
}
