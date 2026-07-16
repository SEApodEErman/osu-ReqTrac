import React from 'react';
import { AlertCircle, CheckCircle2, Clock3, Info, Loader2 } from 'lucide-react';

function formatEta(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

export default function OsuApiToast({ status, notification }) {
  if (!status && !notification) return null;

  const hasError = status?.lastError && status.lastErrorAt && Date.now() - status.lastErrorAt < 10000;
  const totalRequests = (status?.pendingRequests || 0) + (status?.queuedRequests || 0);
  const isWorking = totalRequests > 0 || (status?.rateLimitedSeconds || 0) > 0;
  const hasNotification = Boolean(notification?.message);
  if (!hasError && !isWorking && !hasNotification) return null;
  const notificationType = notification?.type || 'info';
  const showNotification = hasNotification;
  const title = showNotification
    ? (notificationType === 'success' ? 'Success' : notificationType === 'error' ? 'Action failed' : 'Notice')
    : (hasError ? 'osu! API error' : 'osu! API activity');

  return (
    <div className={`osu-api-toast ${showNotification ? `osu-api-toast-${notificationType}` : hasError ? 'osu-api-toast-error' : ''}`} role="status">
      <div className="osu-api-toast-icon">
        {showNotification
          ? (notificationType === 'success' ? <CheckCircle2 size={18} /> : notificationType === 'error' ? <AlertCircle size={18} /> : <Info size={18} />)
          : hasError ? <AlertCircle size={18} /> : isWorking ? <Loader2 size={18} className="spin" /> : <CheckCircle2 size={18} />}
      </div>
      <div className="osu-api-toast-content">
        <strong>{title}</strong>
        {showNotification ? (
          <span>{notification.message}</span>
        ) : hasError ? (
          <span>{status.lastError}</span>
        ) : (
          <span>
            {totalRequests} request{totalRequests === 1 ? '' : 's'} queued · ETA ~{formatEta(status.estimatedSeconds)}
            {status.rateLimitedSeconds > 0 ? ' · rate limited' : ''}
          </span>
        )}
        {!showNotification && !hasError && <small>Throttle: {status.throttleMs / 1000}s per request</small>}
        {!showNotification && !hasError && status.jobs?.length > 0 && (
          <small>{status.jobs.map(job => `${job.label}: ${job.remainingRequests} left`).join(' · ')}</small>
        )}
      </div>
      <Clock3 size={14} className="osu-api-toast-clock" />
    </div>
  );
}
