import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface OverflowMenuAction {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

interface Props {
  label: string;
  actions: readonly OverflowMenuAction[];
  className?: string;
  /**
   * What the viewer presses to open the menu. Defaults to the `⋯` glyph.
   *
   * Supplied where the thing the menu belongs to is already on screen and can
   * be the control itself — the account identity being the case in point.
   * Putting a `⋯` next to it made two adjacent targets for one idea, and the
   * icon beside it looked like a control while doing nothing.
   */
  trigger?: ReactNode;
}

export function OverflowMenu({ label, actions, className = '', trigger }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    rootRef.current?.querySelector<HTMLButtonElement>('.overflow-menu-popover button:not(:disabled)')?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      void Promise.resolve().then(() => triggerRef.current?.focus());
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div ref={rootRef} className={`overflow-menu ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className="overflow-menu-trigger"
        data-tv-focusable="true"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger ?? <span aria-hidden="true">⋯</span>}
      </button>
      {open && (
        <div className="overflow-menu-popover" role="menu">
          {actions.map((action, index) => (
            <button
              key={`${action.label}-${index}`}
              type="button"
              role="menuitem"
              data-tv-focusable="true"
              className={action.destructive ? 'destructive' : undefined}
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
