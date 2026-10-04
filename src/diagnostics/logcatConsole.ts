/**
 * Flattens console arguments to strings: Android's WebView forwards `console.*` to logcat as one
 * string, turning an object argument into `[object Object]`. Installed on the Android build only.
 */
const MAX_SERIALISED_CHARS = 4_000;

function flatten(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const seen = new WeakSet<object>();
  try {
    const text = JSON.stringify(value, (_key, nested: unknown) => {
      // Errors serialise to `{}`, losing the message.
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
