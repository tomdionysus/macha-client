interface Props {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

export function CardCloseButton({ label, onClick, disabled = false, className = '' }: Props) {
  return (
    <button
      type="button"
      className={`card-close-button${className ? ` ${className}` : ''}`}
      data-tv-focusable="true"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">×</span>
    </button>
  );
}
