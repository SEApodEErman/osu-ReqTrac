import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, Info, Loader2, X } from 'lucide-react';

const NOTIFICATION_DURATION_MS = 5000;

function formatEta(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function NotificationToast({ notification, onDismiss }) {
  const timerRef = useRef(null);
  const startedAtRef = useRef(0);
  const remainingMsRef = useRef(NOTIFICATION_DURATION_MS);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    remainingMsRef.current = NOTIFICATION_DURATION_MS;
    startedAtRef.current = Date.now();
    setIsPaused(false);

    timerRef.current = window.setTimeout(onDismiss, NOTIFICATION_DURATION_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [notification.id, onDismiss]);

  const pauseTimer = () => {
    if (!timerRef.current) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingMsRef.current = Math.max(0, remainingMsRef.current - (Date.now() - startedAtRef.current));
    setIsPaused(true);
  };

  const resumeTimer = () => {
    if (!timerRef.current && remainingMsRef.current > 0) {
      startedAtRef.current = Date.now();
      timerRef.current = window.setTimeout(onDismiss, remainingMsRef.current);
    }
    setIsPaused(false);
  };

  const type = notification.type || 'info';
  const title = type === 'success' ? 'Success' : type === 'error' ? 'Action failed' : type === 'warning' ? 'Warning' : 'Notice';

  return (
    <div
      className={`app-toast app-toast-${type}`}
      role={type === 'error' ? 'alert' : 'status'}
      onMouseEnter={pauseTimer}
      onMouseLeave={resumeTimer}
    >
      <div className="app-toast-icon">
        {type === 'success' ? <CheckCircle2 size={18} /> : type === 'error' || type === 'warning' ? <AlertCircle size={18} /> : <Info size={18} />}
      </div>
      <div className="app-toast-content">
        <strong>{title}</strong>
        <span>{notification.message}</span>
        {notification.action && (
          <button
            type="button"
            className="app-toast-action"
            onClick={() => {
              notification.action.onClick();
              onDismiss();
            }}
          >
            {notification.action.label}
          </button>
        )}
      </div>
      <button type="button" className="app-toast-close" onClick={onDismiss} aria-label="Close notification" title="Close">
        <X size={15} />
      </button>
      <div
        key={notification.id}
        className="app-toast-progress"
        style={{ animationPlayState: isPaused ? 'paused' : 'running' }}
        aria-hidden="true"
      />
    </div>
  );
}

export default function Toast({ status, notification, onDismiss = () => {} }) {
  const [dismissedStatusKey, setDismissedStatusKey] = useState(null);
  const hasError = status?.lastError && status.lastErrorAt && Date.now() - status.lastErrorAt < 10000;
  const totalRequests = (status?.pendingRequests || 0) + (status?.queuedRequests || 0);
  const isWorking = totalRequests > 0 || (status?.rateLimitedSeconds || 0) > 0;
  const statusKey = `${status?.lastErrorAt || ''}:${totalRequests}:${status?.rateLimitedSeconds || 0}`;
  const showStatus = !notification && (hasError || isWorking) && dismissedStatusKey !== statusKey;

  useEffect(() => {
    if (!showStatus && dismissedStatusKey && dismissedStatusKey !== statusKey) {
      setDismissedStatusKey(null);
    }
  }, [dismissedStatusKey, showStatus, statusKey]);

  if (notification?.message) {
    return <NotificationToast notification={notification} onDismiss={onDismiss} />;
  }

  if (!showStatus) return null;

  return (
    <div className={`app-toast ${hasError ? 'app-toast-error' : ''}`} role={hasError ? 'alert' : 'status'}>
      <div className="app-toast-icon app-toast-status-icons">
        {hasError ? <AlertCircle size={18} /> : <Loader2 size={18} className="spin" />}
        <Clock3 size={14} className="app-toast-clock" />
      </div>
      <div className="app-toast-content">
        <strong>{hasError ? 'osu! API error' : 'osu! API activity'}</strong>
        {hasError ? (
          <span>{status.lastError}</span>
        ) : (
          <>
            <span>
              {totalRequests} request{totalRequests === 1 ? '' : 's'} queued · ETA ~{formatEta(status.estimatedSeconds)}
              {status.rateLimitedSeconds > 0 ? ' · rate limited' : ''}
            </span>
            <small>Throttle: {status.throttleMs / 1000}s per request</small>
            {status.jobs?.length > 0 && (
              <small>{status.jobs.map(job => `${job.label}: ${job.remainingRequests} left`).join(' · ')}</small>
            )}
          </>
        )}
      </div>
      <button
        type="button"
        className="app-toast-close"
        onClick={() => setDismissedStatusKey(statusKey)}
        aria-label="Close osu! API notification"
        title="Close"
      >
        <X size={15} />
      </button>
    </div>
  );
}
