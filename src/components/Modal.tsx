import { useEffect, useId, useRef, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}

export function Modal({ open, title, children, actions, onClose }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    panelRef.current?.querySelector<HTMLElement>('input, button, [href], [tabindex]:not([tabindex="-1"])')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        <div className="modal-content">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}

interface FormModalProps {
  open: boolean;
  title: string;
  /** The fields. Use `.modal-field` per field, as the rest of the client does. */
  children: ReactNode;
  submitLabel?: string;
  busy?: boolean;
  /** Nothing to save — a pristine form, or one the viewer has not filled in. */
  submitDisabled?: boolean;
  /** A failure that belongs to the dialogue as a whole rather than to one field. */
  error?: ReactNode;
  onSubmit: () => void;
  onCancel: () => void;
}

/**
 * Editing one record, in a dialogue.
 *
 * This is the client's single idiom for changing something: a list shows
 * records compactly and read-only, and every mutation opens one of these. It
 * exists so that no screen hand-rolls the parts that must not vary — a
 * focus-managed panel, Cancel first and the commit second, one busy state
 * disabling both, and Escape meaning cancel. See `docs/architecture.md`.
 *
 * The commit is wired twice, deliberately: the form's `submit` so Enter in a
 * field commits, and the button's `click`. The button is outside the `<form>`
 * because the actions row is the modal's, not the form's, and associating them
 * with a `form` attribute would rest on markup Chromium 47 on the Samsung
 * handles inconsistently. Two call sites of one handler is the cheaper
 * certainty.
 *
 * Field-level errors are not this component's business — they belong beside
 * the field that caused them, which only the caller can place. `error` is for
 * what is left: the failure with no field to sit against.
 */
export function FormModal({
  open,
  title,
  children,
  submitLabel = 'Save',
  busy = false,
  submitDisabled = false,
  error,
  onSubmit,
  onCancel,
}: FormModalProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={busy ? () => undefined : onCancel}
      actions={<>
        <button className="secondary-button" type="button" disabled={busy} onClick={onCancel} data-tv-focusable="true">Cancel</button>
        <button className="primary-button" type="button" disabled={busy || submitDisabled} onClick={onSubmit} data-tv-focusable="true">
          {busy ? 'Working…' : submitLabel}
        </button>
      </>}
    >
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); if (!busy && !submitDisabled) onSubmit(); }}>
        {children}
        {error && <p className="manage-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

interface ConfirmModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  busy = false,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={busy ? () => undefined : onCancel}
      actions={<>
        <button className="secondary-button" type="button" disabled={busy} onClick={onCancel} data-tv-focusable="true">Cancel</button>
        <button className={`primary-button${destructive ? ' modal-danger-action' : ''}`} type="button" disabled={busy} onClick={onConfirm} data-tv-focusable="true">
          {busy ? 'Working…' : confirmLabel}
        </button>
      </>}
    >
      {children}
    </Modal>
  );
}
