import { clientDiagnosticsConsole, type ClientLogEntry } from '@macha/core';

/**
 * Exposes the core's diagnostics buffer on `window.machaDiagnostics`.
 *
 * The buffer is platform-independent and lives in `@macha/core`; reaching a
 * `window` and the Clipboard API are browser affordances, so `copy()` and the
 * global assignment stay here.
 */
export function installClientDiagnosticsConsole(): void {
  if (typeof window === 'undefined') return;
  const console = clientDiagnosticsConsole();
  window.machaDiagnostics = {
    dump: console.dump,
    snapshot: console.snapshot,
    clear: console.clear,
    async copy(): Promise<void> {
      const text = console.dump();
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable in this browser.');
      await navigator.clipboard.writeText(text);
    },
  };
}

declare global {
  interface Window {
    machaDiagnostics?: {
      dump(): string;
      snapshot(): ClientLogEntry[];
      clear(): void;
      copy(): Promise<void>;
    };
  }
}
