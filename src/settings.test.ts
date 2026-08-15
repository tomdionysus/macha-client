import { describe, expect, it } from 'vitest';
import { splashFlashTiming, uiSettings } from './settings';

describe('UI timing settings', () => {
  it('uses a three second splash', () => {
    expect(uiSettings.splashDurationMs).toBe(3_000);
  });

  it('keeps the loading indicator hidden for the first second', () => {
    expect(uiSettings.loadingIndicatorDelayMs).toBe(1_000);
  });

  it('keeps the visible masked sweep centred across most of the configured splash lifetime', () => {
    const timing = splashFlashTiming(3_000);
    expect(timing.durationMs).toBe(2_520);
    expect(timing.delayMs).toBe(240);
    expect(timing.delayMs * 2 + timing.durationMs).toBe(3_000);
  });
});
