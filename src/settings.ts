/**
 * Small UI timing settings kept in code deliberately.
 *
 * These are presentation delays, not server/network timeouts.
 */
export const uiSettings = {
  splashDurationMs: 1_500,
  loadingIndicatorDelayMs: 1_000,
  playerControlsHideDelayMs: 3_500,
} as const;

export function splashFlashTiming(durationMs = uiSettings.splashDurationMs): { delayMs: number; durationMs: number } {
  const flashDurationMs = Math.max(1, Math.round(durationMs * 0.84));
  return {
    delayMs: Math.max(0, Math.round((durationMs - flashDurationMs) / 2)),
    durationMs: flashDurationMs,
  };
}
