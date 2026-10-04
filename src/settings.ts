/** UI presentation delays, not server or network timeouts. */
export const uiSettings = {
  splashDurationMs: 1_000,
  loadingIndicatorDelayMs: 1_000,
  playerControlsHideDelayMs: 3_000,
  playerSeekSpinnerDelayMs: 3_000,
  /** How long a start may take before the viewer is told it is slow: above an ordinary start, well below the start timeouts. */
  playerStartWaitNoticeMs: 5_000,
} as const;

export function splashFlashTiming(durationMs = uiSettings.splashDurationMs): { delayMs: number; durationMs: number } {
  const flashDurationMs = Math.max(1, Math.round(durationMs * 0.90));
  return {
    delayMs: Math.max(0, Math.round((durationMs - flashDurationMs) / 2)),
    durationMs: flashDurationMs,
  };
}

export const diagnosticsSettings = {
  playbackLogLevel: 'debug' as const,
  playbackConsole: true,
  playbackLogBufferEntries: 2_000,
} as const;
