import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
}) {
  const dialogRef = useRef(null);
  const confirmButtonRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    previousFocusRef.current = document.activeElement;
    const focusConfirmButton = window.setTimeout(() => confirmButtonRef.current?.focus(), 0);

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusableElements = dialogRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
      );
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusConfirmButton);
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocusRef.current instanceof HTMLElement) previousFocusRef.current.focus();
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="app-confirmation-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className={`app-confirmation-dialog app-confirmation-dialog-${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-confirmation-title"
        aria-describedby="app-confirmation-message"
      >
        <div className="app-confirmation-header">
          <div className="app-confirmation-icon" aria-hidden="true">
            <AlertTriangle size={20} />
          </div>
          <h2 id="app-confirmation-title">{title}</h2>
          <button type="button" className="app-confirmation-close" onClick={onCancel} aria-label="Close confirmation" title="Close">
            <X size={17} />
          </button>
        </div>
        <p id="app-confirmation-message" className="app-confirmation-message">{message}</p>
        <div className="app-confirmation-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button ref={confirmButtonRef} type="button" className="btn-secondary app-confirmation-confirm" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
