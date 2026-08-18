import { jsx as _jsx } from "react/jsx-runtime";
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import '@fontsource-variable/roboto/wght.css';
import App from './App';
import { runBootSplash } from './bootSplash';
import { configureClientDiagnostics, createClientLogger, installClientDiagnosticsConsole, } from './diagnostics/ClientLog';
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
const samsung = import.meta.env.MODE === 'samsung';
const Router = samsung ? HashRouter : BrowserRouter;
function describeError(error) {
    if (error instanceof Error)
        return error.stack || error.message;
    return String(error);
}
function showSamsungFatal(error) {
    if (!samsung)
        return;
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
    while (root.firstChild)
        root.removeChild(root.firstChild);
    root.appendChild(message);
}
if (samsung) {
    window.addEventListener('error', (event) => showSamsungFatal(event.error ?? event.message));
    window.addEventListener('unhandledrejection', (event) => showSamsungFatal(event.reason));
}
async function boot() {
    const rootElement = document.getElementById('root');
    if (!rootElement)
        throw new Error('Missing #root element');
    log.info('boot-start', { href: window.location.href, userAgent: navigator.userAgent });
    await runBootSplash(rootElement);
    log.debug('splash-complete');
    const platform = detectPlatform();
    log.info('platform-detected', { platform: platform.name });
    ReactDOM.createRoot(rootElement).render(_jsx(Router, { children: _jsx(App, { platform: platform }) }));
    log.info('react-mounted');
}
void boot().catch((error) => {
    log.error('boot-failed', error);
    showSamsungFatal(error);
});
