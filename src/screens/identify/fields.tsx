import type { ReactNode } from 'react';

/** Field parts shared by the unmatched file's manual entry and the metadata editor. */

/** Undefined for an empty field or anything that is not a number. */
export function wholeNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function numberText(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}

export function TextField({ label, value, onChange, disabled, required }: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <label><span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={required} data-tv-focusable="true" />
    </label>
  );
}

export function NumberField({ label, value, onChange, disabled }: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label><span>{label}</span>
      <input inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} data-tv-focusable="true" />
    </label>
  );
}

export function TextAreaField({ label, value, onChange, disabled, rows = 4, className }: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  rows?: number;
  className?: string;
}) {
  return (
    <label className={className}><span>{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} rows={rows} data-tv-focusable="true" />
    </label>
  );
}
