/**
 * Small UI timing settings kept in code deliberately.
 *
 * These are presentation delays, not server/network timeouts.
 */
export const uiSettings = {
    splashDurationMs: 1_000,
    loadingIndicatorDelayMs: 1_000,
    playerControlsHideDelayMs: 3_500,
    playerSeekSpinnerDelayMs: 750,
};
export function splashFlashTiming(durationMs = uiSettings.splashDurationMs) {
    const flashDurationMs = Math.max(1, Math.round(durationMs * 0.90));
    return {
        delayMs: Math.max(0, Math.round((durationMs - flashDurationMs) / 2)),
        durationMs: flashDurationMs,
    };
}
export const diagnosticsSettings = {
    playbackLogLevel: 'debug',
    playbackConsole: true,
    playbackLogBufferEntries: 2_000,
};
