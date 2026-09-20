/**
 * Small UI timing settings kept in code deliberately.
 *
 * These are presentation delays, not server/network timeouts.
 */
export const uiSettings = {
  splashDurationMs: 1_000,
  loadingIndicatorDelayMs: 1_000,
  playerControlsHideDelayMs: 3_000,
  playerSeekSpinnerDelayMs: 3_000,
  /**
   * How long a title may take to start before the viewer is told how long it
   * is taking.
   *
   * Above an ordinary start — a second or two — so the message does not appear
   * and vanish on every title, and well below the budgets that bound the wait:
   * a cold node can legitimately spend 12 s negotiating a generation, 30 s
   * bringing up its first fragment and 20 s more before starvation is called,
   * with nothing bounding the sum. Five seconds is late enough to mean
   * something and early enough to still be company.
   */
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
