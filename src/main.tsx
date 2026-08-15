import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/source-sans-3/wght.css';
import App from './App';
import { runBootSplash } from './bootSplash';
import { detectPlatform } from './platform';
import './styles.css';

async function boot(): Promise<void> {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Missing #root element');

  await runBootSplash(rootElement);

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <BrowserRouter>
        <App platform={detectPlatform()} />
      </BrowserRouter>
    </React.StrictMode>,
  );
}

void boot();
