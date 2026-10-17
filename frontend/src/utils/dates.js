// Dates reach the renderer in three shapes:
//   'YYYY-MM-DD'            calendar dates (deadlines, refreshed added dates)
//   'YYYY-MM-DD HH:MM:SS'   SQLite CURRENT_TIMESTAMP values, which are UTC
//   ISO strings with a zone  osu! timestamps and JS-created values
// `new Date('YYYY-MM-DD')` reads a calendar date as UTC midnight, which shows
// the previous day for anyone west of UTC, so calendar dates are parsed as
// local dates instead.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const SQLITE_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseAppDate(value) {
  if (value === null || value === undefined || value === '' || value === 0 || value === '0') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  const dateOnly = text.match(DATE_ONLY);
  if (dateOnly) {
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const sqlite = text.match(SQLITE_TIMESTAMP);
  const date = new Date(sqlite ? `${sqlite[1]}T${sqlite[2]}Z` : text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Local calendar date for <input type="date"> values.
export function toDateInputValue(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (DATE_ONLY.test(text)) return text;
  const date = parseAppDate(value);
  if (!date) return '';
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayInputValue(now = new Date()) {
  return toDateInputValue(now);
}

export function formatDate(value, fallback = '—') {
  const date = parseAppDate(value);
  return date ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : fallback;
}

export function formatDateTime(value, fallback = '—') {
  // Calendar dates have no time of day to show.
  if (DATE_ONLY.test(String(value ?? '').trim())) return formatDate(value, fallback);
  const date = parseAppDate(value);
  return date
    ? `${date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : fallback;
}

// Whole calendar days from today until the given date (negative when past).
export function daysUntil(value, now = new Date()) {
  const date = parseAppDate(value);
  if (!date) return null;
  return Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
}

export function compareAppDates(a, b) {
  const timeA = parseAppDate(a)?.getTime() ?? null;
  const timeB = parseAppDate(b)?.getTime() ?? null;
  if (timeA === timeB) return 0;
  if (timeA === null) return 1;
  if (timeB === null) return -1;
  return timeA - timeB;
}

// Deadline wording and tone for a request, matching how a mapper reads it.
export function describeDeadline(deadline, requestStatus, now = new Date()) {
  const days = daysUntil(deadline, now);
  if (days === null) return null;
  const done = requestStatus === 'Completed' || requestStatus === 'Cancelled';
  if (done) {
    return { tone: 'muted', days, text: formatDate(deadline) };
  }
  if (days < 0) return { tone: 'overdue', days, text: `${Math.abs(days)}d overdue` };
  if (days === 0) return { tone: 'overdue', days, text: 'Due today' };
  if (days === 1) return { tone: 'urgent', days, text: 'Due tomorrow' };
  if (days <= 3) return { tone: 'urgent', days, text: `${days} days left` };
  if (days <= 7) return { tone: 'soon', days, text: `${days} days left` };
  if (days <= 30) return { tone: 'upcoming', days, text: `${days} days left` };
  return { tone: 'later', days, text: formatDate(deadline) };
}

export function formatRelativeTime(value, now = new Date()) {
  const date = parseAppDate(value);
  if (!date) return '';
  const seconds = Math.round((now - date) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = daysUntil(date, now);
  if (days === -1) return 'yesterday';
  if (days > -7) return `${Math.abs(days)} days ago`;
  return formatDate(date);
}
