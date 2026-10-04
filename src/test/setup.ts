import { afterEach } from 'vitest';
import { configureClientDiagnostics } from '@machafoundation/core';

// Diagnostics are still collected, but kept out of test output.
configureClientDiagnostics({ console: false });

// Only suites that opt into jsdom have a DOM to clean up.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});

// jsdom does no layout, so it lacks scrollIntoView.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}
