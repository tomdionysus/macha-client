import logoUrl from './assets/macha-logo.svg?url';
import { splashFlashTiming, uiSettings } from './settings';

export interface SplashClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const browserClock: SplashClock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
};

export function remainingSplashMs(startedAt: number, now: number, durationMs = uiSettings.splashDurationMs): number {
  return Math.max(0, durationMs - (now - startedAt));
}

export async function waitForSplashMinimum(startedAt: number, durationMs: number, clock: SplashClock): Promise<void> {
  for (;;) {
    const remaining = remainingSplashMs(startedAt, clock.now(), durationMs);
    if (remaining <= 0) return;
    await clock.sleep(remaining);
  }
}

/**
 * Own the boot splash outside React. The application is not mounted until the
 * configured minimum visible lifetime has elapsed.
 */
export async function runBootSplash(root: HTMLElement, clock: SplashClock = browserClock): Promise<void> {
  const durationMs = uiSettings.splashDurationMs;
  if (durationMs <= 0) return;

  const flash = splashFlashTiming(durationMs);
  const splash = document.createElement('div');
  splash.className = 'splash';
  splash.setAttribute('aria-label', 'Macha');

  const mask = document.createElement('div');
  mask.className = 'splash-logo-mask';
  mask.style.setProperty('--macha-logo', `url("${logoUrl}")`);
  mask.style.setProperty('--macha-flash-duration', `${flash.durationMs}ms`);
  mask.style.setProperty('--macha-flash-delay', `${flash.delayMs}ms`);
  splash.append(mask);

  root.replaceChildren(splash);
  const startedAt = clock.now();

  // Measure elapsed monotonic time after every wake-up. Timers may be delayed by
  // the browser, but they must never make the splash shorter than configured.
  await waitForSplashMinimum(startedAt, durationMs, clock);

  root.replaceChildren();
}
