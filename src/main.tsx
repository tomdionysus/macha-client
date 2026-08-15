import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/roboto/wght.css';
import App from './App';
import { runBootSplash } from './bootSplash';
import {
  configureClientDiagnostics,
  createClientLogger,
  installClientDiagnosticsConsole,
} from './diagnostics/ClientLog';
import { detectPlatform } from './platform';
import { diagnosticsSettings } from './settings';
import './styles.css';

configureClientDiagnostics({
  level: diagnosticsSettings.playbackLogLevel,
  console: diagnosticsSettings.playbackConsole,
  maxEntries: diagnosticsSettings.playbackLogBufferEntries,
});
installClientDiagnosticsConsole();
const log = createClientLogger('app.boot');

async function boot(): Promise<void> {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Missing #root element');

  log.info('boot-start', { href: window.location.href, userAgent: navigator.userAgent });
  await runBootSplash(rootElement);
  log.debug('splash-complete');

  const platform = detectPlatform();
  log.info('platform-detected', { platform: platform.name });
  ReactDOM.createRoot(rootElement).render(
    <BrowserRouter>
      <App platform={platform} />
    </BrowserRouter>,
  );
  log.info('react-mounted');
}

void boot().catch((error) => log.error('boot-failed', error));
