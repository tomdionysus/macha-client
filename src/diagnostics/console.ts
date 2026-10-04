import { clientDiagnosticsConsole, type ClientLogEntry } from '@machafoundation/core';

/** Exposes core's diagnostics buffer on `window.machaDiagnostics`, adding the browser-only `copy()`. */
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
