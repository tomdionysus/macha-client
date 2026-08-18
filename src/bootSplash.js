import logoUrl from './assets/macha-logo.svg?url';
import { splashFlashTiming, uiSettings } from './settings';
const browserClock = {
    now: () => performance.now(),
    sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
};
export function navigationLoadType() {
    const entry = performance.getEntriesByType('navigation')[0];
    return entry?.type ?? 'unknown';
}
export function shouldShowBootSplash(type = navigationLoadType()) {
    // BrowserRouter navigation never reaches this module again. Suppress the splash
    // only when the browser itself restores/reloads the document via history.
    return type !== 'back_forward';
}
export function remainingSplashMs(startedAt, now, durationMs = uiSettings.splashDurationMs) {
    return Math.max(0, durationMs - (now - startedAt));
}
export async function waitForSplashMinimum(startedAt, durationMs, clock) {
    for (;;) {
        const remaining = remainingSplashMs(startedAt, clock.now(), durationMs);
        if (remaining <= 0)
            return;
        await clock.sleep(remaining);
    }
}
/**
 * Own the boot splash outside React. The application is not mounted until the
 * configured minimum visible lifetime has elapsed.
 */
export async function runBootSplash(root, clock = browserClock) {
    const durationMs = uiSettings.splashDurationMs;
    if (durationMs <= 0 || !shouldShowBootSplash())
        return;
    const flash = splashFlashTiming(durationMs);
    const splash = document.createElement('div');
    splash.className = 'splash';
    splash.setAttribute('aria-label', 'Macha');
    const mask = document.createElement('div');
    mask.className = 'splash-logo-mask';
    mask.style.setProperty('--macha-logo', `url("${logoUrl}")`);
    mask.style.setProperty('--macha-flash-duration', `${flash.durationMs}ms`);
    mask.style.setProperty('--macha-flash-delay', `${flash.delayMs}ms`);
    splash.appendChild(mask);
    while (root.firstChild)
        root.removeChild(root.firstChild);
    root.appendChild(splash);
    const startedAt = clock.now();
    // Measure elapsed monotonic time after every wake-up. Timers may be delayed by
    // the browser, but they must never make the splash shorter than configured.
    await waitForSplashMinimum(startedAt, durationMs, clock);
    while (root.firstChild)
        root.removeChild(root.firstChild);
}
