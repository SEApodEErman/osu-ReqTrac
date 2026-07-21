export const REQUEST_COLUMNS = [
  { key: 'cover', label: 'Cover' },
  { key: 'song', label: 'Song / Artist', required: true },
  { key: 'tags', label: 'Tags' },
  { key: 'modes', label: 'Gamemode' },
  { key: 'beatmap_status', label: 'Beatmap Status' },
  { key: 'request_status', label: 'Request Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'deadline', label: 'Deadline' },
  { key: 'notes', label: 'Notes' },
  { key: 'added', label: 'Added' },
  { key: 'actions', label: 'Actions' },
];

export const DEFAULT_COLUMN_ORDER = REQUEST_COLUMNS.map(column => column.key);

export function defaultVisibleColumns(category) {
  return new Set([
    'cover', 'beatmap_status', 'request_status', 'priority', 'deadline', 'notes', 'added', 'actions',
    ...(category?.view_type === 'tagged' ? ['tags'] : []),
    ...(category?.view_type === 'guest_difficulties' || category?.system_key === 'guest_difficulties' ? ['modes'] : []),
  ]);
}

export function normalizeColumnOrder(value) {
  const stored = Array.isArray(value) ? value.filter(key => DEFAULT_COLUMN_ORDER.includes(key)) : [];
  return [...new Set([...stored, ...DEFAULT_COLUMN_ORDER])];
}

export function moveColumn(order, sourceKey, targetKey) {
  if (sourceKey === targetKey || !order.includes(sourceKey) || !order.includes(targetKey)) return order;
  const next = order.filter(key => key !== sourceKey);
  next.splice(next.indexOf(targetKey), 0, sourceKey);
  return next;
}

export function requestColumnClassName(key) {
  return `request-col-${key.replaceAll('_', '-')}`;
}
