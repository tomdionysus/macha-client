import type { ReactNode } from 'react';

interface Props {
  label: string;
  busy: boolean;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

export function AsyncIconButton({ label, busy, icon, onClick, disabled = false, className = '' }: Props) {
  return (
    <button
      className={`secondary-button async-icon-button${className ? ` ${className}` : ''}`}
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-label={busy ? `${label} in progress` : label}
      title={busy ? `${label}…` : label}
      aria-busy={busy}
      data-tv-focusable="true"
    >
      {busy ? <span className="button-spinner" aria-hidden="true" /> : icon}
    </button>
  );
}
