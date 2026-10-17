import React, { useRef, useState } from 'react';
import Dialog from './ui/Dialog';

// tone: 'danger' (destructive, red confirm) or 'primary'.
// requireText: the user must type this exact text to confirm.
export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  requireText = null,
  onConfirm,
  onCancel,
}) {
  const [typed, setTyped] = useState('');
  const confirmRef = useRef(null);
  const inputRef = useRef(null);
  const canConfirm = !requireText || typed === requireText;

  return (
    <Dialog
      title={title}
      size="sm"
      onClose={onCancel}
      initialFocusRef={requireText ? inputRef : confirmRef}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button
            ref={confirmRef}
            type="button"
            className={`btn ${tone === 'danger' ? 'btn-danger-solid' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {confirmLabel}
          </button>
        </>
      )}
    >
      <div className="muted" style={{ fontSize: 'var(--text-md)', lineHeight: 1.55 }}>{message}</div>
      {requireText && (
        <form className="field" onSubmit={(event) => { event.preventDefault(); if (canConfirm) onConfirm(); }}>
          <label className="field-label" htmlFor="confirm-text">Type <code>{requireText}</code> to confirm</label>
          <input
            id="confirm-text"
            ref={inputRef}
            className="input"
            value={typed}
            onChange={event => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck="false"
          />
        </form>
      )}
    </Dialog>
  );
}
