/**
 * Flatten console arguments so Android's WebView bridge does not throw the
 * detail away.
 *
 * Chromium forwards `console.*` to logcat as a single string, and an object
 * argument becomes `[object Object]`. Every diagnostic this client writes
 * passes its detail as that second argument, so a whole capture from the
 * Android TV reads `[playback.web] media-time [object Object]` — timings and
 * event names survive, and the endpoint, the mode, the byte counts and the
 * error do not. That is the difference between knowing when something
 * happened and knowing what it was.
 *
 * Only installed on the Android build. A browser console renders objects
 * properly and expandably, and `window.machaDiagnostics.snapshot()` is there
 * for structured access, so flattening everywhere would cost the web target
 * something real to fix a problem it does not have.
 */
const MAX_SERIALISED_CHARS = 4_000;

function flatten(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const seen = new WeakSet<object>();
  try {
    const text = JSON.stringify(value, (_key, nested: unknown) => {
      // Errors serialise to `{}`, which is the one case where the message is
      // the entire point of the line.
      if (nested instanceof Error) return { name: nested.name, message: nested.message };
      if (typeof nested === 'object' && nested !== null) {
        if (seen.has(nested)) return '[circular]';
        seen.add(nested);
      }
      return nested;
    });
    if (text === undefined) return value;
    return text.length > MAX_SERIALISED_CHARS ? `${text.slice(0, MAX_SERIALISED_CHARS)}…` : text;
  } catch {
    return value;
  }
}

export function installLogcatConsoleBridge(target: Console = console): void {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    const original = target[level].bind(target);
    target[level] = (...args: unknown[]) => original(...args.map(flatten));
  }
}
