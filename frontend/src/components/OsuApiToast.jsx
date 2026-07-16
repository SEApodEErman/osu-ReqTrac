import React from 'react';
import { AlertCircle, CheckCircle2, Clock3, Loader2 } from 'lucide-react';

function formatEta(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

export default function OsuApiToast({ status }) {
  if (!status) return null;

  const hasError = status.lastError && status.lastErrorAt && Date.now() - status.lastErrorAt < 10000;
  const totalRequests = status.pendingRequests + (status.queuedRequests || 0);
  const isWorking = totalRequests > 0 || status.rateLimitedSeconds > 0;
  if (!hasError && !isWorking) return null;

  return (
    <div className={`osu-api-toast ${hasError ? 'osu-api-toast-error' : ''}`} role="status">
      <div className="osu-api-toast-icon">
        {hasError ? <AlertCircle size={18} /> : isWorking ? <Loader2 size={18} className="spin" /> : <CheckCircle2 size={18} />}
      </div>
      <div className="osu-api-toast-content">
        <strong>{hasError ? 'osu! API error' : 'osu! API activity'}</strong>
        {hasError ? (
          <span>{status.lastError}</span>
        ) : (
          <span>
            {totalRequests} request{totalRequests === 1 ? '' : 's'} queued · ETA ~{formatEta(status.estimatedSeconds)}
            {status.rateLimitedSeconds > 0 ? ' · rate limited' : ''}
          </span>
        )}
        {!hasError && <small>Throttle: {status.throttleMs / 1000}s per request</small>}
        {!hasError && status.jobs?.length > 0 && (
          <small>{status.jobs.map(job => `${job.label}: ${job.remainingRequests} left`).join(' · ')}</small>
        )}
      </div>
      <Clock3 size={14} className="osu-api-toast-clock" />
    </div>
  );
}
