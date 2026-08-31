export interface SubtitleSegmentManifest {
  format: 'macha-webvtt-segments';
  version: number;
  stream_index: number;
  segment_durations_ms: number[];
}

export function isLegacyWebVtt(url: string): boolean {
  return /\.vtt(?:$|[?#])/i.test(url);
}

export function validSubtitleManifest(value: unknown): value is SubtitleSegmentManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<SubtitleSegmentManifest>;
  return manifest.format === 'macha-webvtt-segments'
    && manifest.version === 1
    && Number.isInteger(manifest.stream_index)
    && Array.isArray(manifest.segment_durations_ms)
    && manifest.segment_durations_ms.length > 0
    && manifest.segment_durations_ms.every((duration) => Number.isFinite(duration) && duration > 0);
}

export function subtitleSegmentStarts(durationsMs: readonly number[]): number[] {
  const starts: number[] = [];
  let total = 0;
  for (const duration of durationsMs) {
    starts.push(total);
    total += duration;
  }
  return starts;
}

export function subtitleSegmentAt(starts: readonly number[], positionMs: number): number {
  const bounded = Math.max(0, positionMs);
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (starts[middle] <= bounded) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function subtitleSegmentWindow(current: number, count: number): number[] {
  const wanted: number[] = [];
  for (let index = current - 1; index <= current + 1; index += 1) {
    if (index >= 0 && index < count) wanted.push(index);
  }
  return wanted;
}
