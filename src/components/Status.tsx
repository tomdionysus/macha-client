import { useEffect, useState } from 'react';
import errorIconUrl from '../assets/error.svg?url';
import { uiSettings } from '../settings';

export function Loading({ delayMs = uiSettings.loadingIndicatorDelayMs }: { delayMs?: number } = {}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), Math.max(0, delayMs));
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  if (!visible) return null;

  return (
    <div className="loading-overlay" role="status" aria-live="polite" aria-label="Loading">
      <div className="loading-spinner" aria-hidden="true" />
    </div>
  );
}

export function ErrorMessage({ error }: { error: Error }) {
  return (
    <div className="status-screen error-status" role="alert">
      <img className="error-icon" src={errorIconUrl} alt="" aria-hidden="true" />
      <p>{error.message}</p>
    </div>
  );
}
