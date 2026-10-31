import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { IconButton, PrimaryButton, SecondaryButton } from './controls.tsx';

type SurfaceProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
};
const focusable =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function DialogSurface({
  open,
  onClose,
  title,
  children,
  actions,
  closeOnBackdrop = true,
  closeOnEscape = true,
  drawer = false,
}: SurfaceProps & { drawer?: boolean }) {
  const headingId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panel.current?.querySelector<HTMLElement>(focusable);
    (first ?? panel.current)?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const controls = Array.from(panel.current.querySelectorAll<HTMLElement>(focusable)).filter(
        (element) => !element.closest('[hidden], [inert], [aria-hidden="true"]'),
      );
      if (!controls.length) {
        event.preventDefault();
        panel.current.focus();
        return;
      }
      const firstControl = controls[0],
        lastControl = controls[controls.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === firstControl || !panel.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        lastControl.focus();
      } else if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault();
        firstControl.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [open, closeOnEscape]);
  if (!open) return null;
  return (
    <div
      className={`ui-dialog-backdrop ${drawer ? 'ui-drawer-backdrop' : ''}`}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className={`ui-dialog ${drawer ? 'ui-drawer' : ''}`}
      >
        <div className="ui-dialog-header">
          <h2 id={headingId}>{title}</h2>
          <IconButton
            aria-label={`Close ${title}`}
            onClick={onClose}
            disabled={!closeOnBackdrop && !closeOnEscape}
          >
            <X size={17} />
          </IconButton>
        </div>
        <div className="ui-dialog-body">{children}</div>
        {actions && <div className="ui-dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}
export function Modal(props: SurfaceProps) {
  return <DialogSurface {...props} />;
}
export function Drawer(props: SurfaceProps) {
  return <DialogSurface {...props} drawer />;
}
export function ConfirmationDialog({
  open,
  title,
  children,
  onCancel,
  onConfirm,
  confirmLabel = 'Confirm',
  busy = false,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      actions={
        <>
          <SecondaryButton disabled={busy} onClick={onCancel}>
            Cancel
          </SecondaryButton>
          <PrimaryButton disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </PrimaryButton>
        </>
      }
    >
      {children}
    </Modal>
  );
}

/** Generic controlled-content menu for actions, with outside-click and Escape dismissal. */
export function DropdownMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const items = () =>
      Array.from(
        root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
      );
    items()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && root.current?.contains(document.activeElement)) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      } else if (
        ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) &&
        root.current?.contains(document.activeElement)
      ) {
        const choices = items();
        if (!choices.length) return;
        event.preventDefault();
        const current = choices.findIndex((item) => item === document.activeElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? choices.length - 1
              : (current + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
        choices[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keydown);
    };
  }, [open]);
  return (
    <div ref={root} className="ui-dropdown">
      <button
        ref={trigger}
        type="button"
        className="ui-button ui-button-secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className="ui-dropdown-menu"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('[role="menuitem"]')) {
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
