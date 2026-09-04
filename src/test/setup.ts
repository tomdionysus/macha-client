import { afterEach } from 'vitest';
import { configureClientDiagnostics } from '../diagnostics/ClientLog';

// Expected playback failure/recovery tests exercise verbose diagnostics. Keep
// collecting those entries while reserving test stdout/stderr for assertions
// and unexpected failures.
configureClientDiagnostics({ console: false });

// Most suites run in the fast 'node' environment with no DOM at all; only
// files that opt into '@vitest-environment jsdom' render real elements, so
// only unmount/clean those.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});

// jsdom deliberately does no layout, so it never implements scrollIntoView.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}
