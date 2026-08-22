import type { PlaybackSession } from './PlaybackResolver';

/**
 * Resolve a relative skip against the latest user-requested target when one
 * exists. The media element's reported time can lag behind while a seek is
 * still converging, so using actualMs unconditionally makes repeated key input
 * target the same position over and over.
 */
export function nextDesiredSeekPosition(
  desiredMs: number | undefined,
  actualMs: number,
  deltaMs: number,
  durationMs: number,
): number {
  const base = desiredMs ?? actualMs;
  return Math.max(0, Math.min(durationMs, base + deltaMs));
}

/** A seek is a position mutation; it must not implicitly change subtitles. */
export function preserveSeekSubtitleState(current: PlaybackSession, next: PlaybackSession): PlaybackSession {
  const selectedSubtitle = current.selected.subtitleStream;
  return {
    ...next,
    preferences: {
      ...next.preferences,
      subtitleStream: selectedSubtitle >= 0 ? (current.preferences.subtitleStream ?? selectedSubtitle) : null,
      subtitleLanguage: current.preferences.subtitleLanguage,
    },
    selected: {
      ...next.selected,
      subtitleStream: selectedSubtitle,
    },
    source: {
      ...next.source,
      subtitleUrl: next.source.subtitleUrl ?? (selectedSubtitle >= 0 ? current.source.subtitleUrl : undefined),
    },
  };
}
