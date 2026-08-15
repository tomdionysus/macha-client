import { describe, expect, it } from 'vitest';
import { splashFlashTiming, uiSettings } from './settings';

describe('UI timing settings', () => {
  it('uses a two second splash', () => {
    expect(uiSettings.splashDurationMs).toBe(2_000);
  });

  it('keeps the loading indicator hidden for the first second', () => {
    expect(uiSettings.loadingIndicatorDelayMs).toBe(1_000);
  });

  it('keeps the visible masked sweep centred across almost all of the configured splash lifetime', () => {
    const timing = splashFlashTiming(2_000);
    expect(timing.durationMs).toBe(1_800);
    expect(timing.delayMs).toBe(100);
    expect(timing.delayMs * 2 + timing.durationMs).toBe(2_000);
  });
});
