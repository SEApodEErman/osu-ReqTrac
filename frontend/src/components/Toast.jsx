import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react';

function ToastIcon({ type }) {
  if (type === 'progress') return <Loader2 size={17} className="spin" />;
  if (type === 'success') return <CheckCircle2 size={17} />;
  if (type === 'error' || type === 'warning') return <AlertCircle size={17} />;
  return <Info size={17} />;
}

const TITLES = { success: 'Done', error: 'Something went wrong', warning: 'Heads up', progress: 'Working…', info: null };

function ToastItem({ toast, onDismiss }) {
  const timerRef = useRef(null);
  const remainingRef = useRef(toast.duration);
  const startedRef = useRef(Date.now());
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    remainingRef.current = toast.duration;
    startedRef.current = Date.now();
    if (!toast.duration) return undefined;
    timerRef.current = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timerRef.current);
  }, [onDismiss, toast.duration, toast.id, toast.createdAt]);

  const pause = () => {
    if (!toast.duration || !timerRef.current) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedRef.current));
    setPaused(true);
  };

  const resume = () => {
    if (!toast.duration || timerRef.current) return;
    startedRef.current = Date.now();
    timerRef.current = window.setTimeout(() => onDismiss(toast.id), remainingRef.current);
    setPaused(false);
  };

  const title = toast.title ?? TITLES[toast.type];
  const percent = toast.progress?.total ? Math.round((toast.progress.completed / toast.progress.total) * 100) : null;

  return (
    <div
      className={`toast toast-${toast.type}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <span className="toast-icon"><ToastIcon type={toast.type} /></span>
      <div className="toast-content">
        {title && <strong>{title}</strong>}
        <span className={title ? 'toast-message' : undefined}>{toast.message}</span>
        {percent !== null && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={{ width: `${percent}%` }} />
          </div>
        )}
        {toast.action && (
          <div className="toast-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                toast.action.onClick();
                onDismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          </div>
        )}
      </div>
      <button type="button" className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
        <X size={14} />
      </button>
      {toast.duration > 0 && (
        <span
          key={toast.createdAt}
          className="toast-timer"
          style={{ animationDuration: `${toast.duration}ms`, animationPlayState: paused ? 'paused' : 'running' }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export default function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map(toast => <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />)}
    </div>
  );
}
