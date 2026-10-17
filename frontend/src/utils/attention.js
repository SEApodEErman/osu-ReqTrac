import { ACTIVE_REQUEST_STATUSES } from './requestConstants.js';
import { daysUntil } from './dates.js';

// Groups of requests that need the mapper's attention, in the order they
// should be dealt with. Each group carries the filter that shows the same
// requests in the Requests view.
export function buildAttentionGroups(requests, now = new Date()) {
  const active = (requests || []).filter(request => ACTIVE_REQUEST_STATUSES.includes(request.request_status));
  const byDeadline = (a, b) => (daysUntil(a.deadline, now) ?? 0) - (daysUntil(b.deadline, now) ?? 0);

  const overdue = active.filter(request => {
    const days = daysUntil(request.deadline, now);
    return days !== null && days <= 0;
  }).sort(byDeadline);
  const dueSoon = active.filter(request => {
    const days = daysUntil(request.deadline, now);
    return days !== null && days > 0 && days <= 7;
  }).sort(byDeadline);
  const undecided = active.filter(request => request.request_status === 'Considering');
  const syncFailed = (requests || []).filter(request => request.metadata_sync_status === 'Failed');
  const highPriorityWaiting = active.filter(request => request.priority === 'High' && request.request_status !== 'Working');

  return [
    { key: 'overdue', title: 'Overdue or due today', tone: 'overdue', requests: overdue, filter: { due: 'overdue' } },
    { key: 'due-soon', title: 'Due in the next 7 days', tone: 'soon', requests: dueSoon, filter: { due: 'week' } },
    { key: 'high-priority', title: 'High priority, not started', tone: 'urgent', requests: highPriorityWaiting, filter: { priority: 'High', status: 'not-working' } },
    { key: 'undecided', title: 'Waiting for your decision', tone: 'neutral', requests: undecided, filter: { status: 'Considering' } },
    { key: 'sync-failed', title: 'Beatmap details failed to sync', tone: 'failed', requests: syncFailed, filter: { sync: 'failed' } },
  ].filter(group => group.requests.length > 0);
}

// Applies the structured filters used by attention drill-throughs and the
// Requests toolbar.
export function requestMatchesQuickFilters(request, { status = '', priority = '', tag = '', due = '', sync = '' } = {}, now = new Date()) {
  if (status === 'active' && !ACTIVE_REQUEST_STATUSES.includes(request.request_status)) return false;
  if (status === 'not-working' && (!ACTIVE_REQUEST_STATUSES.includes(request.request_status) || request.request_status === 'Working')) return false;
  if (status && !['active', 'not-working'].includes(status) && request.request_status !== status) return false;
  if (priority && request.priority !== priority) return false;
  if (tag && !(request.tags || []).includes(tag)) return false;
  if (sync === 'failed' && request.metadata_sync_status !== 'Failed') return false;
  if (due) {
    if (!ACTIVE_REQUEST_STATUSES.includes(request.request_status)) return false;
    const days = daysUntil(request.deadline, now);
    if (days === null) return false;
    if (due === 'overdue' && days > 0) return false;
    if (due === 'week' && (days <= 0 || days > 7)) return false;
    if (due === 'any-deadline' && days === null) return false;
  }
  return true;
}
