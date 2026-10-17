import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Columns3,
  Download,
  ExternalLink,
  FileSpreadsheet,
  HelpCircle,
  ListPlus,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import TagInput from './TagInput';
import CoverImage from './ui/CoverImage';
import { DifficultyStrip, PrioritySelect, StarBadge, StatusSelect } from './ui/Badges';
import { usePopover } from './ui/usePopover';
import { requestMatchesSearch } from '../utils/requestSearch';
import { requestMatchesQuickFilters } from '../utils/attention';
import { compareAppDates, describeDeadline, formatDate } from '../utils/dates';
import { requestsToCsv, downloadTextFile } from '../utils/csv';
import { beatmapsetUrl, openExternal } from '../utils/osuLinks';
import {
  ACTIVE_REQUEST_STATUSES,
  BEATMAP_STATUS_SORT_ORDER,
  PRIORITIES,
  PRIORITY_SORT_ORDER,
  REQUEST_STATUSES,
  REQUEST_STATUS_SORT_ORDER,
  beatmapStatusClass,
  beatmapStatusLabel,
  isMetadataPending,
  requestDisplayTitle,
} from '../utils/requestConstants';
import { REQUEST_COLUMNS, defaultVisibleColumns, moveColumn, normalizeColumnOrder, requestColumnClassName } from '../utils/requestColumns';

const ROW_HEIGHT = { comfortable: 64, compact: 46 };
// Mirrors the column widths in index.css; the beatmap column gets at least
// SONG_MIN_WIDTH and any extra space.
const COLUMN_WIDTHS = {
  select: 40, cover: 72, requester: 130, tags: 150, modes: 112, beatmap_status: 108,
  request_status: 128, priority: 100, deadline: 120, notes: 170, added: 100, actions: 104,
};
const SONG_MIN_WIDTH = 280;
const OVERSCAN = 8;
const DEFAULT_VIEW = { search: '', status: '', priority: '', tag: '', due: '', sync: '', sortBy: 'added_date', sortOrder: 'desc' };
const DESCENDING_FIRST = new Set(['added_date']);
// Deleting this many at once asks first; smaller deletes rely on Undo.
const CONFIRM_DELETE_AT = 10;

const SORT_FIELDS = {
  song: 'title',
  requester: 'requester_username',
  beatmap_status: 'ranked_status',
  request_status: 'request_status',
  priority: 'priority',
  deadline: 'deadline',
  added: 'added_date',
};

const STATUS_FILTER_LABELS = { active: 'Active', 'not-working': 'Not started' };
const DUE_FILTER_LABELS = { overdue: 'Overdue or due today', week: 'Due in 7 days', 'any-deadline': 'Has a deadline' };

function orderedIndex(value, order) {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

function compareRequests(a, b, sortBy) {
  switch (sortBy) {
    case 'ranked_status':
      return orderedIndex(beatmapStatusLabel(a), BEATMAP_STATUS_SORT_ORDER) - orderedIndex(beatmapStatusLabel(b), BEATMAP_STATUS_SORT_ORDER);
    case 'request_status':
      return orderedIndex(a.request_status, REQUEST_STATUS_SORT_ORDER) - orderedIndex(b.request_status, REQUEST_STATUS_SORT_ORDER);
    case 'priority':
      return orderedIndex(a.priority || 'Low', PRIORITY_SORT_ORDER) - orderedIndex(b.priority || 'Low', PRIORITY_SORT_ORDER);
    case 'deadline':
    case 'added_date':
      return 0;
    default:
      return String(a[sortBy] || '').localeCompare(String(b[sortBy] || ''), undefined, { sensitivity: 'base', numeric: true });
  }
}

function sortRequests(requests, sortBy, sortOrder) {
  const direction = sortOrder === 'asc' ? 1 : -1;
  return [...requests].sort((a, b) => {
    if (sortBy === 'deadline' || sortBy === 'added_date') {
      // Missing dates always sort last, whichever direction is chosen.
      const aMissing = !a[sortBy];
      const bMissing = !b[sortBy];
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      return direction * compareAppDates(a[sortBy], b[sortBy]) || b.id - a.id;
    }
    return direction * compareRequests(a, b, sortBy) || compareAppDates(b.added_date, a.added_date) || b.id - a.id;
  });
}

function DeadlineCell({ request }) {
  const deadline = describeDeadline(request.deadline, request.request_status);
  if (!deadline) return <span className="cell-muted">—</span>;
  return (
    <span className={`deadline-text deadline-${deadline.tone}`} title={formatDate(request.deadline)}>
      <Calendar size={12} />{deadline.text}
    </span>
  );
}

const RequestRow = memo(function RequestRow({
  request,
  index,
  columns,
  showGuestDifficulties,
  isSelected,
  isFocused,
  isRefreshing,
  onToggleSelect,
  onOpen,
  onUpdate,
  onDelete,
  onRefresh,
}) {
  const pending = isMetadataPending(request);
  const renderCell = (key) => {
    switch (key) {
      case 'cover':
        return <td key={key}><CoverImage src={request.local_cover_path} /></td>;
      case 'song':
        return (
          <td key={key}>
            <div className="song-cell">
              <div className="song-title-line">
                <span className="song-title" title={request.title || undefined}>{requestDisplayTitle(request)}</span>
                {showGuestDifficulties ? <StarBadge stars={request.my_guest_highest_stars} /> : <StarBadge stars={request.highest_stars} title="Hardest difficulty" />}
              </div>
              <div className="song-meta">
                {pending && !request.artist
                  ? <span>Fetching details from osu!…</span>
                  : <><span className="song-artist">{request.artist || 'Unknown artist'}</span>{request.creator && <span className="song-mapper">{request.creator}</span>}</>}
              </div>
            </div>
          </td>
        );
      case 'requester':
        return <td key={key} className="truncate" title={request.requester_username}>{request.requester_username || <span className="cell-muted">—</span>}</td>;
      case 'tags':
        return (
          <td key={key}>
            {request.tags?.length
              ? <div className="cell-tags">{request.tags.slice(0, 2).map(tag => <span key={tag} className="tag-chip" title={tag}><Tag size={9} />{tag}</span>)}{request.tags.length > 2 && <span className="cell-muted">+{request.tags.length - 2}</span>}</div>
              : <span className="cell-muted">—</span>}
          </td>
        );
      case 'modes':
        return <td key={key}>{request.my_guest_difficulties?.length ? <DifficultyStrip difficulties={request.my_guest_difficulties} /> : <span className="cell-muted">—</span>}</td>;
      case 'beatmap_status':
        return (
          <td key={key}>
            <span className={`pill ${beatmapStatusClass(request)}`} title={request.metadata_sync_status === 'Failed' ? request.metadata_sync_error || 'Sync failed' : undefined}>
              {pending && <RefreshCw size={10} className="spin" />}
              {beatmapStatusLabel(request)}
            </span>
          </td>
        );
      case 'request_status':
        return <td key={key}><StatusSelect value={request.request_status} onChange={status => onUpdate(request.id, { request_status: status })} /></td>;
      case 'priority':
        return <td key={key}><PrioritySelect value={request.priority} onChange={priority => onUpdate(request.id, { priority })} /></td>;
      case 'deadline':
        return <td key={key}><DeadlineCell request={request} /></td>;
      case 'notes':
        return <td key={key} title={request.notes || undefined}>{request.notes ? <span className="cell-notes">{request.notes}</span> : <span className="cell-muted">—</span>}</td>;
      case 'added':
        return <td key={key} className="muted" style={{ fontSize: 'var(--text-sm)' }}>{formatDate(request.added_date)}</td>;
      case 'actions':
        return (
          <td key={key} onClick={event => event.stopPropagation()}>
            <div className="row-actions">
              {request.beatmapset_id && (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => openExternal(beatmapsetUrl(request.beatmapset_id))} title="Open on osu!" aria-label="Open on osu!">
                  <ExternalLink size={14} />
                </button>
              )}
              {request.is_osu_link && request.beatmapset_id && (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onRefresh(request)} disabled={isRefreshing} title="Refresh from osu!" aria-label="Refresh from osu!">
                  <RefreshCw size={14} className={isRefreshing ? 'spin' : undefined} />
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-icon btn-sm is-danger" onClick={() => onDelete(request)} title="Delete (can be undone)" aria-label="Delete request">
                <Trash2 size={14} />
              </button>
            </div>
          </td>
        );
      default:
        return null;
    }
  };

  return (
    <tr
      className={`${isSelected ? 'is-selected' : ''}${isFocused ? ' is-focused' : ''}`}
      onClick={() => onOpen(request)}
      aria-rowindex={index + 2}
      aria-selected={isSelected}
      data-request-id={request.id}
    >
      <td className="col-select" onClick={event => { event.stopPropagation(); onToggleSelect(request.id, index, event.shiftKey); }}>
        <input type="checkbox" checked={isSelected} onChange={() => {}} aria-label={`Select ${requestDisplayTitle(request)}`} />
      </td>
      {columns.map(renderCell)}
    </tr>
  );
});

function SearchHelp() {
  const popover = usePopover();
  return (
    <span ref={popover.containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={popover.toggle} aria-label="Search syntax help" title="Search syntax">
        <HelpCircle size={15} />
      </button>
      {popover.isOpen && (
        <div className="popover popover-end popover-below search-help" role="dialog" aria-label="Search syntax">
          <h3>Search like osu!</h3>
          <p className="muted" style={{ marginBottom: 10 }}>Type words to match titles, artists, mappers, requesters, notes, and tags. Combine with filters:</p>
          <dl>
            <dt><code>creator="Sotarks"</code></dt><dd>Mapper, including old usernames</dd>
            <dt><code>requester=peppy</code></dt><dd>Who asked for it</dd>
            <dt><code>stars&gt;=5.5</code></dt><dd>Any difficulty at least 5.5★</dd>
            <dt><code>mode=mania keys=7</code></dt><dd>Game mode and key count</dd>
            <dt><code>mapstatus=ranked</code></dt><dd>Beatmap status</dd>
            <dt><code>added&gt;=2026-01-01</code></dt><dd>Added on or after a date</dd>
            <dt><code>deadline&lt;2026-11-01</code></dt><dd>Deadline before a date</dd>
            <dt><code>tag=collab</code></dt><dd>Has a tag</dd>
            <dt><code>bpm&gt;200 length&lt;=90</code></dt><dd>BPM and drain time in seconds</dd>
          </dl>
        </div>
      )}
    </span>
  );
}

function ColumnsMenu({ order, visible, density, onToggle, onDensityChange, onReset }) {
  const popover = usePopover();
  return (
    <span ref={popover.containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className="btn btn-secondary" onClick={popover.toggle} aria-expanded={popover.isOpen}>
        <Columns3 size={15} />View
      </button>
      {popover.isOpen && (
        <div className="popover popover-end popover-below" style={{ width: 240 }}>
          <div className="menu">
            <div className="menu-label">Row height</div>
            <div style={{ padding: '2px 6px 6px' }}>
              <div className="segmented">
                <button type="button" aria-pressed={density === 'comfortable'} onClick={() => onDensityChange('comfortable')}>Comfortable</button>
                <button type="button" aria-pressed={density === 'compact'} onClick={() => onDensityChange('compact')}>Compact</button>
              </div>
            </div>
            <div className="menu-separator" />
            <div className="menu-label">Columns · drag headers to reorder</div>
            {order.map(key => {
              const column = REQUEST_COLUMNS.find(item => item.key === key);
              return (
                <label key={key} className="menu-item checkbox">
                  <input type="checkbox" disabled={column.required} checked={column.required || visible.has(key)} onChange={event => onToggle(key, event.target.checked)} />
                  {column.label}
                </label>
              );
            })}
            <div className="menu-separator" />
            <button type="button" className="menu-item" onClick={() => { onReset(); popover.close(); }}>Reset to default</button>
          </div>
        </div>
      )}
    </span>
  );
}

function BulkTagButton({ suggestions, onApply }) {
  const popover = usePopover();
  const [tags, setTags] = useState([]);
  return (
    <span ref={popover.containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className="btn btn-secondary btn-sm" onClick={popover.toggle}><Tag size={13} />Tag</button>
      {popover.isOpen && (
        <div className="popover popover-end popover-above bulk-tags-popover">
          <TagInput value={tags} onChange={setTags} suggestions={suggestions} placeholder="Add tags…" compact autoFocus />
          <div className="view-actions" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setTags([]); popover.close(); }}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={tags.length === 0}
              onClick={async () => {
                if (await onApply(tags)) {
                  setTags([]);
                  popover.close();
                }
              }}
            >
              Add tags
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

export default function RequestsTable({
  title,
  categoryDefinition,
  requests,
  totalRequestCount,
  categories,
  tagSuggestions,
  viewState,
  onViewStateChange,
  columnsPreference,
  onColumnsPreferenceChange,
  density = 'comfortable',
  onDensityChange,
  actions,
  isDateRefreshRunning,
  onOpenRequest,
  onAddRequest,
  onImport,
  searchInputRef,
  onRequestConfirmation,
}) {
  const view = { ...DEFAULT_VIEW, ...viewState };
  const deferredSearch = useDeferredValue(view.search);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [refreshingIds, setRefreshingIds] = useState(() => new Set());
  const [dragColumn, setDragColumn] = useState(null);
  const [dropColumn, setDropColumn] = useState(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 700 });
  const scrollRef = useRef(null);
  const scrollFrameRef = useRef(null);
  const lastToggledIndexRef = useRef(null);
  const rowHeight = ROW_HEIGHT[density] || ROW_HEIGHT.comfortable;

  const visibleColumns = useMemo(() => (Array.isArray(columnsPreference?.visible)
    ? new Set(columnsPreference.visible)
    : defaultVisibleColumns(categoryDefinition)), [categoryDefinition, columnsPreference]);
  const columnOrder = useMemo(() => normalizeColumnOrder(columnsPreference?.order), [columnsPreference]);
  const columns = useMemo(() => columnOrder.filter(key => key === 'song' || visibleColumns.has(key)), [columnOrder, visibleColumns]);
  const showGuestDifficulties = columns.includes('modes');

  const availableTags = useMemo(() => [...new Set(requests.flatMap(request => request.tags || []))].sort((a, b) => a.localeCompare(b)), [requests]);
  const activeCount = useMemo(() => requests.filter(request => ACTIVE_REQUEST_STATUSES.includes(request.request_status)).length, [requests]);

  const filteredRequests = useMemo(() => {
    const quick = { status: view.status, priority: view.priority, tag: view.tag, due: view.due, sync: view.sync };
    const now = new Date();
    const matching = requests.filter(request => requestMatchesQuickFilters(request, quick, now)
      && (!deferredSearch.trim() || requestMatchesSearch(request, deferredSearch)));
    return sortRequests(matching, view.sortBy, view.sortOrder);
  }, [deferredSearch, requests, view.due, view.priority, view.sortBy, view.sortOrder, view.status, view.sync, view.tag]);

  // Only rows the user can currently see are ever acted on in bulk.
  const selectedVisibleIds = useMemo(
    () => filteredRequests.filter(request => selectedIds.has(request.id)).map(request => request.id),
    [filteredRequests, selectedIds],
  );

  const hasFilters = Boolean(view.search || view.status || view.priority || view.tag || view.due || view.sync);
  const updateView = useCallback(patch => onViewStateChange(patch), [onViewStateChange]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;
    const measure = () => setViewport(current => ({ ...current, height: container.clientHeight || 700 }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setViewport(current => ({ ...current, scrollTop: 0 }));
    setFocusedIndex(-1);
  }, [deferredSearch, view.status, view.priority, view.tag, view.due, view.sync, view.sortBy, view.sortOrder]);

  useEffect(() => () => cancelAnimationFrame(scrollFrameRef.current), []);

  const handleScroll = useCallback((event) => {
    const container = event.currentTarget;
    if (scrollFrameRef.current) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      setViewport({ scrollTop: container.scrollTop, height: container.clientHeight || 700 });
    });
  }, []);

  const windowed = useMemo(() => {
    const headerHeight = 38;
    const visibleCount = Math.ceil(viewport.height / rowHeight);
    const start = Math.max(0, Math.floor(Math.max(0, viewport.scrollTop - headerHeight) / rowHeight) - OVERSCAN);
    const end = Math.min(filteredRequests.length, start + visibleCount + OVERSCAN * 2);
    return { start, rows: filteredRequests.slice(start, end), top: start * rowHeight, bottom: Math.max(0, (filteredRequests.length - end) * rowHeight) };
  }, [filteredRequests, rowHeight, viewport]);

  const filteredRef = useRef(filteredRequests);
  filteredRef.current = filteredRequests;

  const toggleSelect = useCallback((id, index, withRange) => {
    setSelectedIds(current => {
      const next = new Set(current);
      const select = !current.has(id);
      if (withRange && lastToggledIndexRef.current !== null) {
        const [from, to] = [lastToggledIndexRef.current, index].sort((a, b) => a - b);
        filteredRef.current.slice(from, to + 1).forEach(request => (select ? next.add(request.id) : next.delete(request.id)));
      } else if (select) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
    lastToggledIndexRef.current = index;
  }, []);

  const handleUpdate = useCallback((id, patch) => {
    void actions.updateRequest(id, patch, { quiet: true });
  }, [actions]);

  const handleDelete = useCallback((request) => {
    actions.deleteRequests([request.id], `“${requestDisplayTitle(request)}”`);
  }, [actions]);

  const handleRefresh = useCallback(async (request) => {
    setRefreshingIds(current => new Set(current).add(request.id));
    window.dispatchEvent(new Event('reqtrac:api-activity'));
    try {
      await actions.refreshBeatmap(request.beatmapset_id, request.id);
    } finally {
      setRefreshingIds(current => {
        const next = new Set(current);
        next.delete(request.id);
        return next;
      });
    }
  }, [actions]);

  const deleteSelected = async () => {
    const ids = [...selectedVisibleIds];
    if (!ids.length) return;
    if (ids.length >= CONFIRM_DELETE_AT) {
      const confirmed = await onRequestConfirmation({
        title: `Delete ${ids.length} requests?`,
        message: 'They’re removed from every category, along with their history. You can still undo for a few seconds afterwards.',
        confirmLabel: `Delete ${ids.length} requests`,
      });
      if (!confirmed) return;
    }
    actions.deleteRequests(ids);
    setSelectedIds(new Set());
  };

  const toggleSort = (field) => {
    if (view.sortBy === field) updateView({ sortOrder: view.sortOrder === 'asc' ? 'desc' : 'asc' });
    else updateView({ sortBy: field, sortOrder: DESCENDING_FIRST.has(field) ? 'desc' : 'asc' });
  };

  const setColumnVisible = (key, isVisible) => {
    const next = new Set(visibleColumns);
    if (isVisible) next.add(key); else next.delete(key);
    onColumnsPreferenceChange({ ...columnsPreference, visible: [...next], order: columnOrder });
  };

  const scrollRowIntoView = (index) => {
    const container = scrollRef.current;
    if (!container) return;
    const top = index * rowHeight + 38;
    if (top < container.scrollTop + 38) container.scrollTop = top - 38;
    else if (top + rowHeight > container.scrollTop + container.clientHeight) container.scrollTop = top + rowHeight - container.clientHeight;
  };

  const handleTableKeyDown = (event) => {
    if (event.target.closest('select, input, button, textarea')) return;
    const count = filteredRequests.length;
    if (!count) return;
    if (event.key === 'ArrowDown' || event.key === 'j') {
      event.preventDefault();
      const next = Math.min(count - 1, focusedIndex + 1);
      setFocusedIndex(next);
      scrollRowIntoView(next);
    } else if (event.key === 'ArrowUp' || event.key === 'k') {
      event.preventDefault();
      const next = Math.max(0, focusedIndex - 1);
      setFocusedIndex(next);
      scrollRowIntoView(next);
    } else if (event.key === 'Enter' && focusedIndex >= 0) {
      event.preventDefault();
      onOpenRequest(filteredRequests[focusedIndex]);
    } else if (event.key === ' ' && focusedIndex >= 0) {
      event.preventDefault();
      toggleSelect(filteredRequests[focusedIndex].id, focusedIndex, event.shiftKey);
    } else if ((event.key === 'a' || event.key === 'A') && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      setSelectedIds(new Set(filteredRequests.map(request => request.id)));
    } else if (event.key === 'Delete') {
      event.preventDefault();
      if (selectedVisibleIds.length) {
        void deleteSelected();
      } else if (focusedIndex >= 0) {
        handleDelete(filteredRequests[focusedIndex]);
      }
    } else if (event.key === 'Escape' && selectedIds.size) {
      event.preventDefault();
      setSelectedIds(new Set());
    }
  };

  const exportCsv = (rows, label) => {
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(`reqtrac-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${date}.csv`, requestsToCsv(rows));
  };

  const renderHeader = (key) => {
    const column = REQUEST_COLUMNS.find(item => item.key === key);
    const sortField = SORT_FIELDS[key];
    const isSorted = sortField && view.sortBy === sortField;
    const SortIcon = !isSorted ? ArrowUpDown : view.sortOrder === 'asc' ? ArrowUp : ArrowDown;
    const label = key === 'actions' ? <span className="sr-only">Quick actions</span> : column.label;
    return (
      <th
        key={key}
        className={`${requestColumnClassName(key)}${dragColumn === key ? ' is-dragging' : ''}${dropColumn === key && dragColumn !== key ? ' is-drop-target' : ''}`}
        draggable
        aria-sort={isSorted ? (view.sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
        onDragStart={(event) => { setDragColumn(key); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key); }}
        onDragOver={(event) => { event.preventDefault(); setDropColumn(key); }}
        onDragLeave={() => setDropColumn(current => (current === key ? null : current))}
        onDrop={(event) => {
          event.preventDefault();
          const source = dragColumn || event.dataTransfer.getData('text/plain');
          if (source) onColumnsPreferenceChange({ ...columnsPreference, visible: [...visibleColumns], order: moveColumn(columnOrder, source, key) });
          setDragColumn(null);
          setDropColumn(null);
        }}
        onDragEnd={() => { setDragColumn(null); setDropColumn(null); }}
      >
        {sortField ? (
          <button type="button" className="sort-button" data-active={isSorted} onClick={() => toggleSort(sortField)} title={`Sort by ${column.label.toLowerCase()}`}>
            <span className="truncate">{label}</span><SortIcon size={12} />
          </button>
        ) : label}
      </th>
    );
  };

  const filterChips = [
    view.status && { key: 'status', label: STATUS_FILTER_LABELS[view.status] || view.status },
    view.priority && { key: 'priority', label: `${view.priority} priority` },
    view.tag && { key: 'tag', label: `Tag: ${view.tag}` },
    view.due && { key: 'due', label: DUE_FILTER_LABELS[view.due] || view.due },
    view.sync && { key: 'sync', label: 'Sync failed' },
  ].filter(Boolean);

  const renderEmpty = () => {
    if (totalRequestCount === 0) {
      return (
        <div className="empty-state">
          <span className="empty-state-icon"><ListPlus size={22} /></span>
          <h3>No requests yet</h3>
          <p>Paste an osu! link to add your first request, or bring in the list you already keep.</p>
          <div className="view-actions">
            <button type="button" className="btn btn-primary" onClick={onAddRequest}><Plus size={15} />Add request</button>
            <button type="button" className="btn btn-secondary" onClick={onImport}><FileSpreadsheet size={15} />Import requests</button>
          </div>
        </div>
      );
    }
    if (requests.length === 0) {
      return (
        <div className="empty-state">
          <span className="empty-state-icon"><ListPlus size={22} /></span>
          <h3>Nothing in {title} yet</h3>
          <p>Requests you add here are tagged {title} automatically. You can also add existing requests from the bulk actions in All requests.</p>
          <div className="view-actions"><button type="button" className="btn btn-primary" onClick={onAddRequest}><Plus size={15} />Add request</button></div>
        </div>
      );
    }
    return (
      <div className="empty-state">
        <span className="empty-state-icon"><Search size={22} /></span>
        <h3>No requests match</h3>
        <p>Nothing in {title} matches your search and filters.</p>
        <div className="view-actions"><button type="button" className="btn btn-secondary" onClick={() => updateView({ ...DEFAULT_VIEW, sortBy: view.sortBy, sortOrder: view.sortOrder })}>Clear search and filters</button></div>
      </div>
    );
  };

  return (
    <div className="requests-view">
      <div className="requests-header">
        <div className="view-header">
          <div>
            <h1 className="view-title">{title}</h1>
            <p className="view-subtitle">
              {activeCount} active · {requests.length} total
              {hasFilters && filteredRequests.length !== requests.length ? ` · showing ${filteredRequests.length}` : ''}
            </p>
          </div>
          <div className="view-actions">
            <button type="button" className="btn btn-secondary" onClick={() => exportCsv(filteredRequests, title)} disabled={!filteredRequests.length} title="Export the requests shown below as CSV">
              <Download size={15} />Export
            </button>
            <button type="button" className="btn btn-secondary" onClick={onImport} title="Import requests (Ctrl+I)"><FileSpreadsheet size={15} />Import</button>
            <button type="button" className="btn btn-primary" onClick={onAddRequest} title="Add request (Ctrl+N)"><Plus size={15} />Add request</button>
          </div>
        </div>

        <div className="requests-toolbar">
          <div className="input-group requests-search">
            <Search size={15} />
            <input
              ref={searchInputRef}
              className="input"
              type="search"
              placeholder="Search title, mapper, requester, notes… (Ctrl+F)"
              value={view.search}
              onChange={event => updateView({ search: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && view.search) {
                  event.stopPropagation();
                  updateView({ search: '' });
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  scrollRef.current?.focus();
                  setFocusedIndex(0);
                }
              }}
              aria-label="Search requests"
              style={{ paddingRight: 70 }}
            />
            <span className="input-group-end">
              {view.search && <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => updateView({ search: '' })} aria-label="Clear search"><X size={14} /></button>}
              <SearchHelp />
            </span>
          </div>
          <select className="input" value={view.status} onChange={event => updateView({ status: event.target.value })} aria-label="Filter by status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="not-working">Not started</option>
            {REQUEST_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
          </select>
          <select className="input" value={view.priority} onChange={event => updateView({ priority: event.target.value })} aria-label="Filter by priority">
            <option value="">Any priority</option>
            {PRIORITIES.map(priority => <option key={priority} value={priority}>{priority}</option>)}
          </select>
          <select className="input" value={view.due} onChange={event => updateView({ due: event.target.value })} aria-label="Filter by deadline">
            <option value="">Any deadline</option>
            <option value="overdue">Overdue or due today</option>
            <option value="week">Due in 7 days</option>
            <option value="any-deadline">Has a deadline</option>
          </select>
          {availableTags.length > 0 && (
            <select className="input" value={view.tag} onChange={event => updateView({ tag: event.target.value })} aria-label="Filter by tag">
              <option value="">Any tag</option>
              {availableTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
            </select>
          )}
          <ColumnsMenu
            order={columnOrder}
            visible={visibleColumns}
            density={density}
            onToggle={setColumnVisible}
            onDensityChange={onDensityChange}
            onReset={() => onColumnsPreferenceChange(null)}
          />
        </div>

        {filterChips.length > 0 && (
          <div className="filter-summary">
            <span>Filtered by</span>
            {filterChips.map(chip => (
              <span key={chip.key} className="filter-chip">
                {chip.label}
                <button type="button" onClick={() => updateView({ [chip.key]: '' })} aria-label={`Remove ${chip.label} filter`}><X size={12} /></button>
              </span>
            ))}
            <button type="button" className="btn-link" onClick={() => updateView({ status: '', priority: '', tag: '', due: '', sync: '' })}>Clear all</button>
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="table-scroll"
        onScroll={handleScroll}
        tabIndex={0}
        onKeyDown={handleTableKeyDown}
        aria-label={`${title} requests. Use the arrow keys to move, Enter to open, Space to select.`}
      >
        {filteredRequests.length === 0 ? renderEmpty() : (
          <table
            className={`requests-table${density === 'compact' ? ' is-compact' : ''}`}
            style={{ '--row-height': `${rowHeight}px`, minWidth: columns.reduce((sum, key) => sum + (key === 'song' ? SONG_MIN_WIDTH : COLUMN_WIDTHS[key] || 0), COLUMN_WIDTHS.select) }}
            aria-rowcount={filteredRequests.length + 1}
          >
            <colgroup>
              <col className="col-select" />
              {columns.map(key => <col key={key} className={requestColumnClassName(key)} />)}
            </colgroup>
            <thead>
              <tr>
                <th className="col-select">
                  <input
                    type="checkbox"
                    checked={selectedVisibleIds.length > 0 && selectedVisibleIds.length === filteredRequests.length}
                    ref={element => { if (element) element.indeterminate = selectedVisibleIds.length > 0 && selectedVisibleIds.length < filteredRequests.length; }}
                    onChange={event => setSelectedIds(event.target.checked ? new Set(filteredRequests.map(request => request.id)) : new Set())}
                    aria-label="Select all shown requests"
                  />
                </th>
                {columns.map(renderHeader)}
              </tr>
            </thead>
            <tbody>
              {windowed.top > 0 && <tr className="spacer-row" aria-hidden="true"><td colSpan={columns.length + 1} style={{ height: windowed.top }} /></tr>}
              {windowed.rows.map((request, offset) => {
                const index = windowed.start + offset;
                return (
                  <RequestRow
                    key={request.id}
                    request={request}
                    index={index}
                    columns={columns}
                    showGuestDifficulties={showGuestDifficulties}
                    isSelected={selectedIds.has(request.id)}
                    isFocused={focusedIndex === index}
                    isRefreshing={refreshingIds.has(request.id)}
                    onToggleSelect={toggleSelect}
                    onOpen={onOpenRequest}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                    onRefresh={handleRefresh}
                  />
                );
              })}
              {windowed.bottom > 0 && <tr className="spacer-row" aria-hidden="true"><td colSpan={columns.length + 1} style={{ height: windowed.bottom }} /></tr>}
            </tbody>
          </table>
        )}
      </div>

      {selectedVisibleIds.length > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
          <span className="bulk-count">{selectedVisibleIds.length} selected</span>
          <select
            className="input input-sm"
            value=""
            onChange={(event) => { if (event.target.value) void actions.bulkSetStatus(selectedVisibleIds, event.target.value); }}
            aria-label="Set status"
          >
            <option value="">Set status…</option>
            {REQUEST_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
          </select>
          <select
            className="input input-sm"
            value=""
            onChange={(event) => { if (event.target.value) void actions.bulkSetPriority(selectedVisibleIds, event.target.value); }}
            aria-label="Set priority"
          >
            <option value="">Set priority…</option>
            {PRIORITIES.map(priority => <option key={priority} value={priority}>{priority}</option>)}
          </select>
          <select
            className="input input-sm"
            value=""
            onChange={(event) => {
              const [mode, id] = event.target.value.split(':');
              if (id) void actions.bulkSetCategory(selectedVisibleIds, id, mode).then(ok => { if (ok && mode === 'move') setSelectedIds(new Set()); });
            }}
            aria-label="Change category"
          >
            <option value="">Category…</option>
            <optgroup label="Add to">
              {categories.map(category => <option key={`add-${category.id}`} value={`add:${category.id}`}>{category.name}</option>)}
            </optgroup>
            <optgroup label="Move to (replaces others)">
              {categories.map(category => <option key={`move-${category.id}`} value={`move:${category.id}`}>{category.name}</option>)}
            </optgroup>
          </select>
          <BulkTagButton suggestions={tagSuggestions} onApply={tags => actions.bulkAddTags(selectedVisibleIds, tags)} />
          <span className="bulk-divider" />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={isDateRefreshRunning}
            onClick={async () => {
              const ids = [...selectedVisibleIds];
              const confirmed = await onRequestConfirmation({
                title: `Replace the added date of ${ids.length} request${ids.length === 1 ? '' : 's'}?`,
                message: 'Each osu!-linked request gets its map’s ranked or loved date, or its last-updated date if it isn’t ranked or loved. Manual requests are skipped.',
                confirmLabel: 'Use osu! dates',
                tone: 'primary',
              });
              if (confirmed) void actions.refreshDates(ids);
            }}
            title="Set added dates from osu!"
          >
            <RefreshCw size={13} className={isDateRefreshRunning ? 'spin' : undefined} />osu! dates
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => exportCsv(filteredRequests.filter(request => selectedIds.has(request.id)), `${title} selection`)}>
            <Download size={13} />Export
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => void deleteSelected()}
            title="Delete selected (can be undone)"
          >
            <Trash2 size={13} />Delete
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setSelectedIds(new Set())} aria-label="Clear selection" title="Clear selection (Esc)">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
