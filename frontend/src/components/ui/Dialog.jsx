import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// Open dialogs, innermost last, so Escape only closes the top one.
const openDialogs = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function isAnyDialogOpen() {
  return openDialogs.length > 0;
}

export default function Dialog({
  onClose,
  title,
  description,
  size = 'md',
  variant = 'dialog',
  busy = false,
  closeOnBackdrop = true,
  initialFocusRef,
  footer,
  header,
  className = '',
  bodyClassName = '',
  children,
}) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  const titleId = useId();
  const descriptionId = useId();
  onCloseRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const token = Symbol('dialog');
    openDialogs.push(token);
    const previousFocus = document.activeElement;
    const focusTimer = window.setTimeout(() => {
      const target = initialFocusRef?.current
        || dialogRef.current?.querySelector('[data-autofocus]')
        || dialogRef.current?.querySelector(FOCUSABLE);
      target?.focus();
    }, 0);

    const handleKeyDown = (event) => {
      if (openDialogs.at(-1) !== token) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll(FOCUSABLE)].filter(element => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown, true);
      const index = openDialogs.indexOf(token);
      if (index !== -1) openDialogs.splice(index, 1);
      if (previousFocus instanceof HTMLElement && document.contains(previousFocus)) previousFocus.focus();
    };
    // The dialog's lifetime is its mount; callbacks are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDrawer = variant === 'drawer';
  return createPortal(
    <div
      className={`dialog-backdrop${isDrawer ? ' is-drawer below-topbar' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && closeOnBackdrop && !busyRef.current) onCloseRef.current?.();
      }}
    >
      <section
        ref={dialogRef}
        className={`dialog dialog-${size}${isDrawer ? ' drawer' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Dialog'}
        aria-describedby={description ? descriptionId : undefined}
      >
        {header ?? (title && (
          <header className="dialog-header">
            <div className="dialog-header-text">
              <h2 id={titleId} className="dialog-title">{title}</h2>
              {description && <p id={descriptionId} className="dialog-description">{description}</p>}
            </div>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onCloseRef.current?.()} disabled={busy} aria-label="Close">
              <X size={17} />
            </button>
          </header>
        ))}
        <div className={`dialog-body ${bodyClassName}`}>{children}</div>
        {footer && <footer className="dialog-footer">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}
