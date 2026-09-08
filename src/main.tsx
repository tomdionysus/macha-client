import ReactDOM from 'react-dom/client';
import '@fontsource-variable/roboto/wght.css';
import App from './App';
import { AppRouter } from './app/AppRouter';
import { runBootSplash } from './bootSplash';
import {
  configureClientDiagnostics,
  configureMachaHost,
  createClientLogger,
} from '@macha/core';
import { installClientDiagnosticsConsole } from './diagnostics/console';
import { detectPlatform } from './platform';
import { diagnosticsSettings } from './settings';
import { installDirectPlayReadAheadDiagnostics, warmDirectPlayReadAhead } from './playback/directPlayReadAhead';
import { installAbortControllerPolyfill } from './platform/AbortControllerPolyfill';
import './styles.css';

const samsung = import.meta.env.MODE === 'samsung';
installAbortControllerPolyfill(window);
// Everything the core needs from a host. Storage, clock, id generation and
// performance all auto-detect correctly in a browser; only the origin has to
// be supplied, and it is what the API layer resolves relative artwork and
// stream URLs against on a same-origin deployment.
configureMachaHost({ origin: window.location.origin });
configureClientDiagnostics({
  level: samsung ? 'warn' : diagnosticsSettings.playbackLogLevel,
  console: samsung ? false : diagnosticsSettings.playbackConsole,
  maxEntries: samsung ? 256 : diagnosticsSettings.playbackLogBufferEntries,
});
installClientDiagnosticsConsole();
if (!samsung) installDirectPlayReadAheadDiagnostics();
const log = createClientLogger('app.boot');

function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

function showSamsungFatal(error: unknown): void {
  if (!samsung) return;
  const root = document.getElementById('root') ?? document.body;
  const message = document.createElement('pre');
  message.style.background = '#180000';
  message.style.color = '#ffffff';
  message.style.fontFamily = 'monospace';
  message.style.fontSize = '24px';
  message.style.margin = '0';
  message.style.padding = '32px';
  message.style.whiteSpace = 'pre-wrap';
  message.textContent = `Macha Samsung runtime failure\n\n${describeError(error)}\n\n${navigator.userAgent}`;
  while (root.firstChild) root.removeChild(root.firstChild);
  root.appendChild(message);
}

if (samsung) {
  window.addEventListener('error', (event) => showSamsungFatal(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => showSamsungFatal(event.reason));
}

async function boot(): Promise<void> {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Missing #root element');

  log.info('boot-start', { href: window.location.href, userAgent: navigator.userAgent });
  // The splash is presentation, never a boot dependency. Mount the application
  // immediately and let the fixed overlay finish its visual lifetime in parallel.
  const splashHost = document.createElement('div');
  splashHost.style.pointerEvents = 'none';
  document.body.appendChild(splashHost);
  void runBootSplash(splashHost).finally(() => {
    splashHost.remove();
    log.debug('splash-complete');
  });

  const platform = detectPlatform();
  log.info('platform-detected', { platform: platform.name });
  if (platform.name === 'web') warmDirectPlayReadAhead();
  ReactDOM.createRoot(rootElement).render(
    <AppRouter>
      <App platform={platform} />
    </AppRouter>,
  );
  log.info('react-mounted');
}

void boot().catch((error) => {
  log.error('boot-failed', error);
  showSamsungFatal(error);
});
