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

export type NavigationLoadType = 'navigate' | 'reload' | 'back_forward' | 'prerender' | 'unknown';

export function navigationLoadType(): NavigationLoadType {
  const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return entry?.type ?? 'unknown';
}

export function shouldShowBootSplash(type: NavigationLoadType = navigationLoadType()): boolean {
  // BrowserRouter navigation never reaches this module again. Suppress the splash
  // only when the browser itself restores/reloads the document via history.
  return type !== 'back_forward';
}

export function remainingSplashMs(startedAt: number, now: number, durationMs: number = uiSettings.splashDurationMs): number {
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
 * Own the boot splash outside React. Its minimum visual lifetime is independent
 * of application mount and may never delay application work.
 */
export async function runBootSplash(root: HTMLElement, clock: SplashClock = browserClock): Promise<void> {
  const durationMs = uiSettings.splashDurationMs;
  if (durationMs <= 0 || !shouldShowBootSplash()) return;

  const flash = splashFlashTiming(durationMs);
  const splash = document.createElement('div');
  splash.className = 'splash';
  splash.setAttribute('aria-label', 'Macha');

  if (import.meta.env.MODE === 'samsung') {
    const image = document.createElement('img');
    image.src = logoUrl;
    image.alt = '';
    image.style.width = '320px';
    image.style.height = '320px';
    image.style.objectFit = 'contain';
    splash.appendChild(image);
  } else {
    const mask = document.createElement('div');
    mask.className = 'splash-logo-mask';
    mask.style.setProperty('--macha-logo', `url("${logoUrl}")`);
    mask.style.setProperty('--macha-flash-duration', `${flash.durationMs}ms`);
    mask.style.setProperty('--macha-flash-delay', `${flash.delayMs}ms`);
    splash.appendChild(mask);
  }

  while (root.firstChild) root.removeChild(root.firstChild);
  root.appendChild(splash);
  const startedAt = clock.now();

  // Measure elapsed monotonic time after every wake-up. Timers may be delayed by
  // the browser, but they must never make the splash shorter than configured.
  await waitForSplashMinimum(startedAt, durationMs, clock);

  while (root.firstChild) root.removeChild(root.firstChild);
}
