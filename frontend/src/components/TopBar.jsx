import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Minus, PanelLeft, Square, X } from 'lucide-react';
import appIcon from '../assets/app-icon.svg';
import { usePopover } from './ui/usePopover';

const BUSY_POLL_MS = 1000;
const IDLE_POLL_MS = 4000;
const RECENT_ERROR_MS = 60000;

function formatDuration(seconds) {
  if (!seconds) return '';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

// Polls the osu! API queue here, rather than in App, so its once-a-second
// updates only re-render this indicator.
function useOsuApiStatus() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let lastText = '';
    const poll = async () => {
      let busy = false;
      try {
        const response = await fetch('/api/osu/status');
        if (response.ok) {
          const text = await response.text();
          const next = JSON.parse(text);
          busy = (next.pendingRequests || 0) + (next.queuedRequests || 0) > 0 || next.rateLimitedSeconds > 0;
          if (text !== lastText && !cancelled) {
            lastText = text;
            setStatus(next);
          }
        }
      } catch {
        // The indicator simply keeps its last state while the server restarts.
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, busy ? BUSY_POLL_MS : IDLE_POLL_MS);
      }
    };
    void poll();
    const pollNow = () => {
      window.clearTimeout(timer);
      void poll();
    };
    window.addEventListener('focus', pollNow);
    window.addEventListener('reqtrac:api-activity', pollNow);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('focus', pollNow);
      window.removeEventListener('reqtrac:api-activity', pollNow);
    };
  }, []);

  return status;
}

function ActivityIndicator({ isConfigured, metadataSyncStatus, onOpenSettings }) {
  const status = useOsuApiStatus();
  const popover = usePopover();
  const queued = (status?.pendingRequests || 0) + (status?.queuedRequests || 0);
  const syncing = (metadataSyncStatus?.Pending || 0) + (metadataSyncStatus?.Processing || 0);
  const failed = metadataSyncStatus?.Failed || 0;
  const rateLimited = (status?.rateLimitedSeconds || 0) > 0;
  const recentError = status?.lastError && status.lastErrorAt && Date.now() - status.lastErrorAt < RECENT_ERROR_MS;

  let state = 'idle';
  let label = 'osu! connected';
  if (!isConfigured) {
    state = 'offline';
    label = 'osu! not set up';
  } else if (rateLimited) {
    state = 'limited';
    label = `osu! paused ${formatDuration(status.rateLimitedSeconds)}`;
  } else if (queued > 0 || syncing > 0) {
    state = 'busy';
    label = syncing > 0 ? `Syncing ${syncing} map${syncing === 1 ? '' : 's'}` : `${queued} osu! call${queued === 1 ? '' : 's'} queued`;
  } else if (recentError) {
    state = 'error';
    label = 'osu! error';
  }

  return (
    <div className="activity-indicator no-drag" ref={popover.containerRef}>
      <button
        type="button"
        className="activity-button"
        data-state={state}
        onClick={() => (isConfigured ? popover.toggle() : onOpenSettings())}
        aria-expanded={popover.isOpen}
        title={isConfigured ? 'osu! API activity' : 'Set up the osu! API in Settings'}
      >
        {state === 'busy' ? <Loader2 size={13} className="spin" /> : state === 'limited' || state === 'error' ? <AlertTriangle size={13} /> : <span className="activity-dot" />}
        <span>{label}</span>
      </button>
      {popover.isOpen && (
        <div className="popover popover-end popover-below activity-panel" role="dialog" aria-label="osu! API activity">
          <h3>osu! API</h3>
          <p className="field-hint" style={{ marginBottom: 10 }}>
            Calls are paced at about one per second to stay within osu!’s rate limits. Things you click go first; background syncing waits its turn.
          </p>
          <div className="activity-row"><span className="muted">Waiting calls</span><strong>{queued}{status?.estimatedSeconds ? ` · ~${formatDuration(status.estimatedSeconds)}` : ''}</strong></div>
          {(status?.jobs || []).map(job => (
            <div key={job.id} className="activity-row"><span className="muted truncate">{job.label}</span><strong>{job.remainingRequests} left</strong></div>
          ))}
          {metadataSyncStatus && (
            <div className="activity-row">
              <span className="muted">Beatmap details</span>
              <strong>{syncing > 0 ? `${syncing} syncing` : 'Up to date'}{failed ? ` · ${failed} failed` : ''}</strong>
            </div>
          )}
          {rateLimited && <div className="activity-row"><span className="muted">Rate limited by osu!</span><strong>resumes in {formatDuration(status.rateLimitedSeconds)}</strong></div>}
          {recentError && <p className="field-error" style={{ marginTop: 8, overflowWrap: 'anywhere' }}>{status.lastError}</p>}
          {failed > 0 && (
            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => { popover.close(); onOpenSettings('data'); }}>
              Review failed syncs
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function TopBar({ sectionName, onToggleSidebar, isSidebarCollapsed, isConfigured, metadataSyncStatus, onOpenSettings }) {
  const controls = window.electronAPI?.windowControls;
  const toggleMaximize = () => void controls?.toggleMaximize();

  return (
    <header className="app-topbar">
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm no-drag"
        onClick={onToggleSidebar}
        aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={`${isSidebarCollapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+B)`}
      >
        <PanelLeft size={16} />
      </button>
      <div className="app-topbar-title">
        <img src={appIcon} alt="" />
        <span className="app-topbar-name">osu!ReqTrac</span>
        <span className="app-topbar-separator">/</span>
        <span className="app-topbar-section truncate">{sectionName}</span>
      </div>
      <div className="app-topbar-spacer" onDoubleClick={toggleMaximize} />
      <ActivityIndicator isConfigured={isConfigured} metadataSyncStatus={metadataSyncStatus} onOpenSettings={onOpenSettings} />
      {controls && (
        <div className="app-window-controls no-drag">
          <button type="button" onClick={() => void controls.minimize()} aria-label="Minimize"><Minus size={15} /></button>
          <button type="button" onClick={toggleMaximize} aria-label="Maximize"><Square size={12} /></button>
          <button type="button" onClick={() => void controls.close()} aria-label="Close" className="app-window-close"><X size={15} /></button>
        </div>
      )}
      {!controls && <span style={{ width: 8 }} />}
    </header>
  );
}
