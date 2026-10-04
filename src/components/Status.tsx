import { useEffect, useState } from 'react';
import errorIconUrl from '../assets/error.svg?url';
import { uiSettings } from '../settings';

export function Loading({ delayMs = uiSettings.loadingIndicatorDelayMs, note }: { delayMs?: number; note?: string } = {}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), Math.max(0, delayMs));
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  if (!visible) return null;

  return (
    <div className="loading-overlay" role="status" aria-live="polite" aria-label="Loading">
      <div className="loading-spinner" aria-hidden="true" />
      {/* Inside the `aria-live` region so the note is announced when it appears. */}
      {note && <p className="loading-note">{note}</p>}
    </div>
  );
}

/** An inline wait inside a panel; `Loading` is the page-sized one. */
export function Waiting({ children }: { children: string }) {
  return (
    <p className="waiting-note" role="status" aria-live="polite">
      <span className="button-spinner" aria-hidden="true" />
      {children}
    </p>
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
