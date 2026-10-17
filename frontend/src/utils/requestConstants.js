// Single source for request vocabulary so every screen uses the same words,
// order, and colour classes.

export const REQUEST_STATUSES = ['Considering', 'Accepted', 'Working', 'Completed', 'Cancelled'];
export const ACTIVE_REQUEST_STATUSES = ['Considering', 'Accepted', 'Working'];
export const PRIORITIES = ['High', 'Medium', 'Low'];
export const BEATMAP_STATUSES = ['Manual', 'Graveyard', 'WIP', 'Pending', 'Qualified', 'Loved', 'Ranked'];

export const REQUEST_STATUS_HINTS = {
  Considering: 'Not decided yet',
  Accepted: 'Agreed, not started',
  Working: 'In progress',
  Completed: 'Delivered',
  Cancelled: 'Will not be done',
};

// Sort order used when sorting the table by a status-like column.
export const REQUEST_STATUS_SORT_ORDER = ['Working', 'Accepted', 'Considering', 'Completed', 'Cancelled'];
export const PRIORITY_SORT_ORDER = ['High', 'Medium', 'Low'];
export const BEATMAP_STATUS_SORT_ORDER = ['Manual', 'WIP', 'Pending', 'Qualified', 'Loved', 'Ranked', 'Graveyard'];

export const GAMEMODES = [
  { value: 'osu', label: 'osu!' },
  { value: 'taiko', label: 'osu!taiko' },
  { value: 'fruits', label: 'osu!catch' },
  { value: 'mania', label: 'osu!mania' },
];

export function gamemodeLabel(mode) {
  return GAMEMODES.find(item => item.value === mode)?.label || 'osu!';
}

export function statusClass(status) {
  return `status-${String(status || 'considering').toLowerCase()}`;
}

export function priorityClass(priority) {
  return `priority-${String(priority || 'low').toLowerCase()}`;
}

export function isMetadataPending(request) {
  return request?.metadata_sync_status === 'Pending' || request?.metadata_sync_status === 'Processing';
}

const MAP_STATUS_LABELS = { wip: 'WIP', graveyard: 'Graveyard', pending: 'Pending', qualified: 'Qualified', approved: 'Approved', ranked: 'Ranked', loved: 'Loved' };

export function formatMapStatus(status) {
  const text = String(status || 'pending');
  return MAP_STATUS_LABELS[text.toLowerCase()] || text;
}

export function beatmapStatusLabel(request) {
  if (!request?.is_osu_link) return 'Manual';
  if (isMetadataPending(request)) return 'Syncing';
  if (request.metadata_sync_status === 'Failed') return 'Sync failed';
  return formatMapStatus(request.ranked_status);
}

export function beatmapStatusClass(request) {
  const label = beatmapStatusLabel(request);
  if (label === 'Syncing') return 'map-syncing';
  if (label === 'Sync failed') return 'map-failed';
  return `map-${label.toLowerCase()}`;
}

export function requestDisplayTitle(request) {
  if (request?.title) return request.title;
  if (isMetadataPending(request)) return 'Syncing beatmap details…';
  return request?.beatmapset_id ? `Beatmapset ${request.beatmapset_id}` : 'Untitled request';
}

export const DEFAULT_COVER = '/uploads/covers/default.jpg';
