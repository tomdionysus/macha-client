import { describe, expect, it } from 'vitest';
import { splashFlashTiming, uiSettings } from './settings';
describe('UI timing settings', () => {
    it('uses a one second splash', () => {
        expect(uiSettings.splashDurationMs).toBe(1_000);
    });
    it('keeps the loading indicator hidden for the first second', () => {
        expect(uiSettings.loadingIndicatorDelayMs).toBe(1_000);
    });
    it('gives seek restarts a short grace period before showing a spinner', () => {
        expect(uiSettings.playerSeekSpinnerDelayMs).toBe(750);
    });
    it('hides player controls after three seconds of inactivity', () => {
        expect(uiSettings.playerControlsHideDelayMs).toBe(3_000);
    });
    it('keeps the visible masked sweep centred across almost all of the configured splash lifetime', () => {
        const timing = splashFlashTiming(1_000);
        expect(timing.durationMs).toBe(900);
        expect(timing.delayMs).toBe(50);
        expect(timing.delayMs * 2 + timing.durationMs).toBe(1_000);
    });
});
