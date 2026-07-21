import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  ArrowUpDown, 
  Search, 
  Trash2, 
  Edit3, 
  ChevronRight, 
  Calendar,
  X,
  ExternalLink,
  MessageSquare,
  Tag,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import TagInput from './TagInput';
import { requestMatchesSearch } from '../utils/requestSearch';
import { REQUEST_COLUMNS, defaultVisibleColumns, moveColumn, normalizeColumnOrder, requestColumnClassName } from '../utils/requestColumns';

// osu! official star difficulty spectrum from osu.Game.Rulesets.Osu.Difficulty.OsuColour
// https://github.com/ppy/osu/blob/master/osu.Game.Rulesets.Osu/Difficulty/OsuColour.cs
const STAR_DIFFICULTY_SPECTRUM = [
  { stars: 0.0, color: '#aaaaaa' },
  { stars: 0.1, color: '#aaaaaa' },
  { stars: 0.1, color: '#4290fb' },
  { stars: 1.25, color: '#4fc0ff' },
  { stars: 2.0, color: '#4fffd5' },
  { stars: 2.5, color: '#7cff4f' },
  { stars: 3.3, color: '#f6f05c' },
  { stars: 4.2, color: '#ff8068' },
  { stars: 4.9, color: '#ff4e6f' },
  { stars: 5.8, color: '#c645b8' },
  { stars: 6.7, color: '#6563de' },
  { stars: 7.7, color: '#18158e' },
  { stars: 9.0, color: '#000000' },
  { stars: 10.0, color: '#000000' },
];

function getStarDifficultyColor(stars) {
  if (stars <= 0) return '#aaaaaa';
  if (stars >= 10) return '#000000';
  
  // Find the two spectrum points to interpolate between
  for (let i = 0; i < STAR_DIFFICULTY_SPECTRUM.length - 1; i++) {
    const current = STAR_DIFFICULTY_SPECTRUM[i];
    const next = STAR_DIFFICULTY_SPECTRUM[i + 1];
    
    if (stars >= current.stars && stars <= next.stars) {
      // Linear interpolation between the two colors
      const ratio = (stars - current.stars) / (next.stars - current.stars);
      return interpolateColor(current.color, next.color, ratio);
    }
  }
  
  // Fallback
  return '#aaaaaa';
}

// osu! text colour logic from StarRatingDisplay.cs
// < 6.5★: Black, 6.5–9.0★: Orange, 9.0★+: gradient spectrum
const STAR_TEXT_CUTOFF = 6.5;
const STAR_TEXT_GRADIENT_CUTOFF = 9.0;
const STAR_TEXT_SPECTRUM = [
  { stars: 9.0, color: '#f6f05c' },
  { stars: 9.9, color: '#ff8068' },
  { stars: 10.6, color: '#ff4e6f' },
  { stars: 11.5, color: '#c645b8' },
  { stars: 12.4, color: '#6563de' },
];

const BEATMAP_STATUS_ORDER = ['Manual', 'WIP', 'Pending', 'Qualified', 'Loved', 'Ranked'];
const REQUEST_STATUS_ORDER = ['Working', 'Accepted', 'Considering', 'Completed', 'Cancelled'];
const PRIORITY_ORDER = ['High', 'Medium', 'Low'];
const RANKED_SORT_FIELDS = new Set(['ranked_status', 'request_status', 'priority']);
const VIRTUAL_ROW_HEIGHT = 72;
const VIRTUAL_OVERSCAN = 8;

function getOrderedValue(value, order) {
  const normalizedValue = (value || '').toString().toLowerCase();
  const index = order.findIndex(item => item.toLowerCase() === normalizedValue);
  return index === -1 ? order.length : index;
}

function getStarDifficultyTextColor(stars) {
  if (stars < STAR_TEXT_CUTOFF) return 'rgba(0,0,0,0.75)';
  if (stars < STAR_TEXT_GRADIENT_CUTOFF) return '#f6f05c';

  for (let i = 0; i < STAR_TEXT_SPECTRUM.length - 1; i++) {
    const current = STAR_TEXT_SPECTRUM[i];
    const next = STAR_TEXT_SPECTRUM[i + 1];
    if (stars >= current.stars && stars <= next.stars) {
      const ratio = (stars - current.stars) / (next.stars - current.stars);
      return interpolateColor(current.color, next.color, ratio);
    }
  }

  return '#6563de';
}

function interpolateColor(color1, color2, ratio) {
  // Parse hex colors to RGB
  const hex1 = color1.replace('#', '');
  const hex2 = color2.replace('#', '');
  
  const r1 = parseInt(hex1.substring(0, 2), 16);
  const g1 = parseInt(hex1.substring(2, 4), 16);
  const b1 = parseInt(hex1.substring(4, 6), 16);
  
  const r2 = parseInt(hex2.substring(0, 2), 16);
  const g2 = parseInt(hex2.substring(2, 4), 16);
  const b2 = parseInt(hex2.substring(4, 6), 16);
  
  // Interpolate
  const r = Math.round(r1 + (r2 - r1) * ratio);
  const g = Math.round(g1 + (g2 - g1) * ratio);
  const b = Math.round(b1 + (b2 - b1) * ratio);
  
  // Convert back to hex
  const toHex = (c) => c.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function StarRatingBadge({ stars }) {
  if (!(stars > 0)) return null;

  const color = getStarDifficultyColor(stars);
  const textColor = getStarDifficultyTextColor(stars);
  const [r, g, b] = [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ];

  return (
    <span
      title="Highest star rating"
      aria-label={`Highest star rating: ${stars.toFixed(2)}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 7px',
        borderRadius: '12px',
        fontSize: '10px',
        lineHeight: 1.2,
        fontWeight: '700',
        background: `rgba(${r}, ${g}, ${b}, 0.7)`,
        color: textColor,
        border: `1px solid rgba(${r}, ${g}, ${b}, 1.0)`,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {'\u2605'} {stars.toFixed(2)}
    </span>
  );
}

function GuestDifficultySummary({ stars, difficulties = [] }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: '3px', flexShrink: 0 }}>
      <StarRatingBadge stars={stars} />
      {difficulties.length > 0 && <span aria-label={`${difficulties.length} guest difficulties`} style={{ display: 'inline-flex', gap: '2px', minHeight: '4px' }}>
        {difficulties.slice(0, 8).map((difficulty, index) => {
          const color = getStarDifficultyColor(Number(difficulty.stars) || 0);
          return <span key={difficulty.id || difficulty.assignment_id || `${difficulty.mode}-${difficulty.name}-${index}`} title={`${difficulty.name || 'Unnamed difficulty'} (${difficulty.mode === 'fruits' ? 'catch' : difficulty.mode || 'osu'}) - ${Number(difficulty.stars || 0).toFixed(2)} stars${difficulty.pending ? ' (pending)' : ''}`} style={{ width: '8px', height: '4px', borderRadius: '3px', background: difficulty.pending ? 'transparent' : color, border: `1px solid ${color}` }} />;
        })}
        {difficulties.length > 8 && <span style={{ fontSize: '9px', lineHeight: '5px', color: 'var(--text-muted)' }}>+{difficulties.length - 8}</span>}
      </span>}
    </span>
  );
}

function SortableHeader({ label, shortLabel = label, onSort, dragProps }) {
  return (
    <th onClick={onSort} className="sortable-header" title={label} aria-label={`Sort by ${label}`} style={{ cursor: 'pointer', ...dragProps?.style }} {...dragProps}>
      <span className="sortable-header-content">
        <span><span className="header-label-full">{label}</span><span className="header-label-short">{shortLabel}</span></span>
        <ArrowUpDown size={12} />
      </span>
    </th>
  );
}

export default function RequestsTable({ 
  requestsList, 
  onOpenRequest, 
  onDeleteRequest, 
  onUpdateRequest,
  onBulkUpdateStatus,
  isBulkStatusUpdating = false,
  onBulkRefreshDates,
  isBulkDateRefreshing = false,
  onBulkUpdatePriority,
  onBulkUpdateCategory,
  onBulkAddTags,
  onBulkDelete,
  onRequestConfirmation = async () => false,
  activeCategory,
  activeCategoryDefinition,
  categoryDefinitions = [],
  tagSuggestions = [],
  sortBy,
  sortOrder,
  onSortChange,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkTags, setBulkTags] = useState([]);
  const [isBulkTagsOpen, setIsBulkTagsOpen] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const columnStorageKey = `request-columns:${activeCategoryDefinition?.id || 'all'}`;
  const columnOrderStorageKey = `${columnStorageKey}:order`;
  const [visibleColumns, setVisibleColumns] = useState(() => defaultVisibleColumns(activeCategoryDefinition));
  const [columnOrder, setColumnOrder] = useState(() => normalizeColumnOrder());
  const [draggedColumn, setDraggedColumn] = useState(null);
  const tableContainerRef = useRef(null);
  const scrollFrameRef = useRef(null);
  const [virtualViewport, setVirtualViewport] = useState({ scrollTop: 0, height: 600 });

  useEffect(() => {
    const controls = window.electronAPI?.windowControls;
    let isActive = true;

    void controls?.isMaximized?.().then(isMaximized => {
      if (isActive) setIsWindowMaximized(Boolean(isMaximized));
    });
    const removeMaximizedListener = controls?.onMaximizedChange?.(isMaximized => {
      setIsWindowMaximized(Boolean(isMaximized));
    });

    return () => {
      isActive = false;
      removeMaximizedListener?.();
    };
  }, []);
  
  const toggleSort = (field) => {
    if (sortBy === field) {
      onSortChange(field, sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      onSortChange(field, RANKED_SORT_FIELDS.has(field) ? 'asc' : 'desc');
    }
  };

  // Compile list of unique tags for the tag filter dropdown
  const allAvailableTags = useMemo(() => {
    const tags = new Set();
    requestsList.forEach(r => {
      if (r.tags) r.tags.forEach(t => tags.add(t));
    });
    return Array.from(tags).sort();
  }, [requestsList]);

  // Calculate deadline colors dynamically
  const getDeadlineInfo = (deadlineStr) => {
    if (!deadlineStr) return null;
    const deadline = new Date(deadlineStr);
    const today = new Date();
    today.setHours(0,0,0,0);
    deadline.setHours(0,0,0,0);

    const diffTime = deadline - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let color = 'var(--req-completed)'; // Green (> 30 days)
    let text = `${diffDays} days left`;

    if (diffDays <= 0) {
      color = 'var(--req-cancelled)'; // Red
      text = diffDays === 0 ? 'Today' : `${Math.abs(diffDays)}d overdue`;
    } else if (diffDays <= 3) {
      color = 'var(--priority-high)'; // Orange/Red
    } else if (diffDays <= 7) {
      color = 'var(--priority-medium)'; // Yellow/Orange
    } else if (diffDays <= 30) {
      color = '#cca000'; // Yellow
    }

    return { color, text };
  };

  // Filter requests
  const filteredRequests = useMemo(() => {
    let result = [...requestsList];

    // Search filter
    if (searchTerm.trim()) {
      result = result.filter(r => requestMatchesSearch(r, searchTerm));
    }

    // Category filter (Left Sidebar navigation)
    if (activeCategory && activeCategory !== 'All') {
      result = result.filter(r => r.categories.some(c => c.category_name === activeCategory));
    }

    // Status filter
    if (statusFilter) {
      result = result.filter(r => r.request_status === statusFilter);
    }

    // Priority filter
    if (priorityFilter) {
      result = result.filter(r => r.priority === priorityFilter);
    }

    // Tag filter
    if (tagFilter) {
      result = result.filter(r => r.tags && r.tags.includes(tagFilter));
    }

    // Apply sorting
    result.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];

      // Handle custom ordering fields
      if (sortBy === 'ranked_status') {
        valA = getOrderedValue(a.ranked_status || 'Manual', BEATMAP_STATUS_ORDER);
        valB = getOrderedValue(b.ranked_status || 'Manual', BEATMAP_STATUS_ORDER);
      } else if (sortBy === 'request_status') {
        valA = getOrderedValue(a.request_status, REQUEST_STATUS_ORDER);
        valB = getOrderedValue(b.request_status, REQUEST_STATUS_ORDER);
      } else if (sortBy === 'priority') {
        valA = getOrderedValue(a.priority, PRIORITY_ORDER);
        valB = getOrderedValue(b.priority, PRIORITY_ORDER);
      } else if (sortBy === 'added_date' || sortBy === 'deadline' || sortBy === 'last_updated') {
        valA = valA ? new Date(valA) : (sortOrder === 'asc' ? new Date(9999, 11) : new Date(0));
        valB = valB ? new Date(valB) : (sortOrder === 'asc' ? new Date(9999, 11) : new Date(0));
      } else {
        valA = (valA || '').toString().toLowerCase();
        valB = (valB || '').toString().toLowerCase();
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [requestsList, searchTerm, activeCategory, statusFilter, priorityFilter, tagFilter, sortBy, sortOrder]);

  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return undefined;

    const updateHeight = () => {
      setVirtualViewport(current => ({ ...current, height: container.clientHeight || 600 }));
    };
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = tableContainerRef.current;
    if (container) container.scrollTop = 0;
    setVirtualViewport(current => ({ ...current, scrollTop: 0 }));
  }, [searchTerm, activeCategory, statusFilter, priorityFilter, tagFilter, sortBy, sortOrder]);

  useEffect(() => () => {
    if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const handleVirtualScroll = useCallback((event) => {
    const container = event.currentTarget;
    if (scrollFrameRef.current) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      setVirtualViewport({
        scrollTop: container.scrollTop,
        height: container.clientHeight || 600,
      });
    });
  }, []);

  const virtualWindow = useMemo(() => {
    const visibleCount = Math.ceil(virtualViewport.height / VIRTUAL_ROW_HEIGHT);
    const start = Math.max(0, Math.floor(virtualViewport.scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const end = Math.min(filteredRequests.length, start + visibleCount + (VIRTUAL_OVERSCAN * 2));
    return {
      rows: filteredRequests.slice(start, end),
      start,
      topSpacerHeight: start * VIRTUAL_ROW_HEIGHT,
      bottomSpacerHeight: Math.max(0, (filteredRequests.length - end) * VIRTUAL_ROW_HEIGHT),
    };
  }, [filteredRequests, virtualViewport]);

  // Bulk select toggles
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(filteredRequests.map(r => r.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (e, id) => {
    e.stopPropagation();
    if (e.target.checked) {
      setSelectedIds(prev => [...prev, id]);
    } else {
      setSelectedIds(prev => prev.filter(rowId => rowId !== id));
    }
  };

  const handleClearFilters = () => {
    setSearchTerm('');
    setStatusFilter('');
    setPriorityFilter('');
    setTagFilter('');
  };

  const handleBulkCategoryAction = (event, mode) => {
    if (!event.target.value) return;
    onBulkUpdateCategory(selectedIds, event.target.value, mode);
    setSelectedIds([]);
    event.target.value = '';
  };

  const dismissBulkToolbar = () => {
    setSelectedIds([]);
    setBulkTags([]);
    setIsBulkTagsOpen(false);
  };

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(columnStorageKey));
      const storedOrder = JSON.parse(localStorage.getItem(columnOrderStorageKey));
      setVisibleColumns(Array.isArray(stored) ? new Set(stored) : defaultVisibleColumns(activeCategoryDefinition));
      setColumnOrder(normalizeColumnOrder(storedOrder));
    } catch {
      setVisibleColumns(defaultVisibleColumns(activeCategoryDefinition));
      setColumnOrder(normalizeColumnOrder());
    }
  }, [columnOrderStorageKey, columnStorageKey, activeCategoryDefinition]);

  const setColumnVisible = (key, visible) => {
    setVisibleColumns(current => {
      const next = new Set(current);
      if (visible) next.add(key); else next.delete(key);
      localStorage.setItem(columnStorageKey, JSON.stringify([...next]));
      return next;
    });
  };

  const reorderColumns = (sourceKey, targetKey) => {
    setColumnOrder(current => {
      const next = moveColumn(current, sourceKey, targetKey);
      localStorage.setItem(columnOrderStorageKey, JSON.stringify(next));
      return next;
    });
  };

  const visibleDataColumns = columnOrder.filter(key => key === 'song' || visibleColumns.has(key));
  const showTags = visibleDataColumns.includes('tags');
  const showModes = visibleDataColumns.includes('modes');
  const showCover = visibleDataColumns.includes('cover');
  const showBeatmapStatus = visibleDataColumns.includes('beatmap_status');
  const showRequestStatus = visibleDataColumns.includes('request_status');
  const showPriority = visibleDataColumns.includes('priority');
  const showDeadline = visibleDataColumns.includes('deadline');
  const showNotes = visibleDataColumns.includes('notes');
  const showAdded = visibleDataColumns.includes('added');
  const showActions = visibleDataColumns.includes('actions');
  const columnCount = 1 + visibleDataColumns.length;

  const renderColumnDefinition = (key) => <col key={key} className={requestColumnClassName(key)} />;

  const getColumnDragProps = (key) => ({
    draggable: true,
    onDragStart: (event) => {
      setDraggedColumn(key);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', key);
    },
    onDragOver: (event) => event.preventDefault(),
    onDrop: (event) => {
      event.preventDefault();
      const sourceKey = draggedColumn || event.dataTransfer.getData('text/plain');
      if (sourceKey) reorderColumns(sourceKey, key);
      setDraggedColumn(null);
    },
    onDragEnd: () => setDraggedColumn(null),
    style: { cursor: draggedColumn === key ? 'grabbing' : 'grab', opacity: draggedColumn === key ? 0.55 : 1 },
  });

  const renderColumnHeader = (key) => {
    switch (key) {
      case 'cover': return <th key={key} {...getColumnDragProps(key)}>Cover</th>;
      case 'song': return <SortableHeader key={key} label="Song / Artist" onSort={() => toggleSort('title')} dragProps={getColumnDragProps(key)} />;
      case 'tags': return <th key={key} {...getColumnDragProps(key)}>Tags</th>;
      case 'modes': return <th key={key} {...getColumnDragProps(key)}>Gamemode</th>;
      case 'beatmap_status': return <SortableHeader key={key} label="Beatmap Status" shortLabel="B. Status" onSort={() => toggleSort('ranked_status')} dragProps={getColumnDragProps(key)} />;
      case 'request_status': return <SortableHeader key={key} label="Request Status" shortLabel="Status" onSort={() => toggleSort('request_status')} dragProps={getColumnDragProps(key)} />;
      case 'priority': return <SortableHeader key={key} label="Priority" shortLabel="Prio" onSort={() => toggleSort('priority')} dragProps={getColumnDragProps(key)} />;
      case 'deadline': return <SortableHeader key={key} label="Deadline" shortLabel="Due" onSort={() => toggleSort('deadline')} dragProps={getColumnDragProps(key)} />;
      case 'notes': return <th key={key} {...getColumnDragProps(key)}>Notes</th>;
      case 'added': return <SortableHeader key={key} label="Added" onSort={() => toggleSort('added_date')} dragProps={getColumnDragProps(key)} />;
      case 'actions': return <th key={key} {...getColumnDragProps(key)} style={{ textAlign: 'right', ...getColumnDragProps(key).style }}>Actions</th>;
      default: return null;
    }
  };

  const renderRequestColumn = (req, key, { deadlineInfo, isMetadataPending, metadataFailed }) => {
    switch (key) {
      case 'cover':
        return <td key={key}><img className="request-cover" src={req.local_cover_path} alt="cover" width={56} height={32} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.src = '/uploads/covers/default.jpg'; }} /></td>;
      case 'song':
        return <td key={key} className="request-song-cell">
          <div className="request-song-content">
            <div className="request-title-line">
              <span className="request-title" title={req.title}>{req.title || (isMetadataPending ? 'Syncing metadata...' : `Beatmapset ${req.beatmapset_id}`)}</span>
              {req.priority === 'High' && <span className="request-priority-dot" title="High Priority" aria-label="High Priority" />}
              {showModes ? <GuestDifficultySummary stars={req.my_guest_highest_stars} difficulties={req.my_guest_difficulties} /> : <StarRatingBadge stars={req.highest_stars} />}
            </div>
            <div className="request-song-subtitle">
              {isMetadataPending && !req.artist ? 'Background sync in progress' : <><span className="request-artist" title={req.artist || 'Unknown artist'}>{req.artist || 'Unknown artist'}</span><span className="request-creator" title={req.creator || 'Unknown creator'}>{req.creator || 'Unknown creator'}</span></>}
            </div>
          </div>
        </td>;
      case 'tags':
        return <td key={key}>{req.tags?.length ? <div className="request-tags">{req.tags.slice(0, 2).map(tag => <span key={tag} className="tag-badge" title={tag}><Tag size={9} />{tag}</span>)}{req.tags.length > 2 && <span className="request-tags-more">+{req.tags.length - 2}</span>}</div> : <span className="request-empty">—</span>}</td>;
      case 'modes':
        return <td key={key}><div className="request-modes">{(req.gamemodes || []).length > 0 ? req.gamemodes.map(mode => <span key={mode} className="badge badge-pending">{mode === 'fruits' ? 'catch' : mode}</span>) : <span className="request-empty">—</span>}</div></td>;
      case 'beatmap_status':
        return <td key={key}><span title={metadataFailed ? req.metadata_sync_error : undefined} className={`badge request-beatmap-badge badge-${metadataFailed ? 'cancelled' : isMetadataPending ? 'pending' : (req.ranked_status || 'Manual').toLowerCase()}`}>{isMetadataPending && <RefreshCw size={10} className="spin" style={{ marginRight: '4px' }} />}{metadataFailed && <AlertCircle size={10} style={{ marginRight: '4px' }} />}{metadataFailed ? 'Sync failed' : isMetadataPending ? 'Syncing' : (req.ranked_status || 'Manual')}</span></td>;
      case 'request_status':
        return <td key={key} onClick={(event) => event.stopPropagation()}><div className={`status-badge-select request-table-select badge badge-${req.request_status.toLowerCase()}`}><select value={req.request_status} onChange={(event) => onUpdateRequest(req.id, { request_status: event.target.value })} className={`status-badge-inner badge badge-${req.request_status.toLowerCase()}`} aria-label="Request status"><option className="status-option-accepted" value="Accepted">Accepted</option><option className="status-option-considering" value="Considering">Considering</option><option className="status-option-working" value="Working">Working</option><option className="status-option-completed" value="Completed">Completed</option><option className="status-option-cancelled" value="Cancelled">Cancelled</option></select><div className="request-select-chevron"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg></div></div></td>;
      case 'priority':
        return <td key={key} onClick={(event) => event.stopPropagation()}><div className={`status-badge-select request-table-select badge badge-priority-${(req.priority || 'Low').toLowerCase()}`}><select value={req.priority || 'Low'} onChange={(event) => onUpdateRequest(req.id, { priority: event.target.value })} className={`status-badge-inner badge badge-priority-${(req.priority || 'Low').toLowerCase()}`} aria-label="Priority"><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select><div className="request-select-chevron"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg></div></div></td>;
      case 'deadline':
        return <td key={key}>{deadlineInfo ? <span className="request-deadline" style={{ color: deadlineInfo.color }}><Calendar size={12} />{deadlineInfo.text}</span> : <span className="request-empty">—</span>}</td>;
      case 'notes':
        return <td key={key} className="request-notes-cell" title={req.notes || undefined} style={{ color: req.notes ? 'var(--text-main)' : 'var(--text-muted)' }}><span className="request-notes">{req.notes || '—'}</span></td>;
      case 'added':
        return <td key={key} className="request-added-date">{req.added_date ? new Date(req.added_date).toLocaleDateString() : '—'}</td>;
      case 'actions':
        return <td key={key} onClick={(event) => event.stopPropagation()} style={{ textAlign: 'right' }}><div className="request-row-actions"><button onClick={() => onOpenRequest(req)} title="Open Details" style={{ padding: '6px', borderRadius: '4px', color: 'var(--text-muted)', cursor: 'pointer' }} onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = 'var(--hover-bg)'; }} onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = 'transparent'; }}><Edit3 size={14} /></button><button onClick={async () => { const confirmed = await onRequestConfirmation({ title: 'Delete request?', message: 'This request and its associated categories will be permanently deleted.', confirmLabel: 'Delete request' }); if (confirmed) onDeleteRequest(req.id); }} title="Delete" style={{ padding: '6px', borderRadius: '4px', color: 'var(--text-muted)', cursor: 'pointer' }} onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = 'rgba(231, 76, 60, 0.1)'; event.currentTarget.style.color = 'var(--priority-high)'; }} onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = 'transparent'; event.currentTarget.style.color = 'var(--text-muted)'; }}><Trash2 size={14} /></button></div></td>;
      default:
        return null;
    }
  };

  return (
    <div style={{ padding: '0 24px 24px 24px', display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
      
      {/* Header and Row Count */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: '700', fontFamily: 'var(--font-display)' }}>
            {activeCategory === 'All' ? 'All Requests' : activeCategory}
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Showing {filteredRequests.length} of {requestsList.length} total requests
          </p>
        </div>
      </div>

      {/* Filters Row */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search */}
        <div style={{ position: 'relative', minWidth: '220px', flexGrow: 1 }}>
          <span style={{ position: 'absolute', left: '10px', top: '9px', color: 'var(--text-muted)' }}>
            <Search size={14} />
          </span>
          <input
            type="text"
            className="input-text"
            placeholder={'Search or filter: creator="Mahiru Shiina"'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ paddingLeft: '32px', fontSize: '13px' }}
          />
          <span title={'Examples: creator="Mahiru Shiina" tag=collab mapstatus=Ranked added>=2026-01-01 stars>=5 mode=mania keys=4'} style={{ position: 'absolute', right: searchTerm ? '34px' : '10px', top: '9px', color: 'var(--text-muted)', fontSize: '11px', cursor: 'help' }}>?</span>
          {searchTerm && (
            <button 
              onClick={() => setSearchTerm('')} 
              style={{ position: 'absolute', right: '10px', top: '9px', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Request Status Filter */}
        <select 
          className="input-text" 
          style={{ width: '140px', fontSize: '13px' }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="Accepted">Accepted</option>
          <option value="Considering">Considering</option>
          <option value="Working">Working</option>
          <option value="Completed">Completed</option>
          <option value="Cancelled">Cancelled</option>
        </select>

        {/* Priority Filter */}
        <select 
          className="input-text" 
          style={{ width: '130px', fontSize: '13px' }}
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
        >
          <option value="">All Priorities</option>
          <option value="Low">Low</option>
          <option value="Medium">Medium</option>
          <option value="High">High</option>
        </select>

        {/* Tag Filter */}
        <select 
          className="input-text" 
          style={{ width: '130px', fontSize: '13px' }}
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
        >
          <option value="">All Tags</option>
          {allAvailableTags.map(tag => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>

        {/* Clear Filters Button */}
        {(searchTerm || statusFilter || priorityFilter || tagFilter) && (
          <button 
            onClick={handleClearFilters}
            className="btn-secondary"
            style={{ padding: '6px 12px', fontSize: '12px' }}
          >
            Clear Filters
          </button>
        )}
        <details style={{ position: 'relative' }}>
          <summary className="btn-secondary" style={{ listStyle: 'none', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}>Columns</summary>
          <div style={{ position: 'absolute', right: 0, zIndex: 30, minWidth: '190px', marginTop: '5px', padding: '10px', display: 'grid', gap: '7px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: 'var(--shadow-lg)' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Drag table headers to reorder columns</span>
            {columnOrder.map(key => {
              const column = REQUEST_COLUMNS.find(item => item.key === key);
              return <label
                key={key}
                style={{ display: 'flex', gap: '7px', alignItems: 'center', fontSize: '12px', cursor: 'pointer' }}
              >
                <input type="checkbox" disabled={column.required} checked={column.required || visibleColumns.has(key)} onChange={event => setColumnVisible(key, event.target.checked)} />
                {column.label}
              </label>;
            })}
          </div>
        </details>
      </div>

      {/* Main Table Container */}
      <div
        ref={tableContainerRef}
        className="table-container requests-table-container"
        onScroll={handleVirtualScroll}
      >
        {filteredRequests.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No requests match your current filters.
          </div>
        ) : (
          <table
            className={`compact-table requests-table${showTags ? ' requests-table-with-tags' : ''}`}
            aria-rowcount={filteredRequests.length}
          >
            <colgroup>
              <col className="request-col-select" />
              {visibleDataColumns.map(renderColumnDefinition)}
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: 'center' }}>
                  <input 
                    type="checkbox" 
                    onChange={handleSelectAll} 
                    checked={selectedIds.length > 0 && selectedIds.length === filteredRequests.length}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                {visibleDataColumns.map(renderColumnHeader)}
              </tr>
            </thead>
            <tbody>
              {virtualWindow.topSpacerHeight > 0 && (
                <tr className="virtual-spacer-row" aria-hidden="true">
                  <td colSpan={columnCount} style={{ height: `${virtualWindow.topSpacerHeight}px` }} />
                </tr>
              )}
              {virtualWindow.rows.map((req, virtualIndex) => {
                const deadlineInfo = getDeadlineInfo(req.deadline);
                const isChecked = selectedIds.includes(req.id);
                const isMetadataPending = req.metadata_sync_status === 'Pending' || req.metadata_sync_status === 'Processing';
                const metadataFailed = req.metadata_sync_status === 'Failed';
                


                return (
                  <tr 
                    key={req.id} 
                    onClick={() => onOpenRequest(req)}
                    aria-rowindex={virtualWindow.start + virtualIndex + 2}
                    style={{ backgroundColor: isChecked ? 'var(--hover-bg)' : '' }}
                  >
                    {/* Checkbox */}
                    <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
                      <input 
                        type="checkbox" 
                        checked={isChecked}
                        onChange={(e) => handleSelectRow(e, req.id)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>

                    {visibleDataColumns.map(key => renderRequestColumn(req, key, { deadlineInfo, isMetadataPending, metadataFailed }))}

                    {false && <>
                    {/* Cover Photo */}
                    {showCover && <td>
                      <img
                        className="request-cover"
                        src={req.local_cover_path} 
                        alt="cover" 
                        width={56}
                        height={32}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          e.target.src = '/uploads/covers/default.jpg';
                        }}
                      />
                    </td>}

                    {/* Metadata (Title + Artist + Creator) */}
                    <td className="request-song-cell">
                      <div className="request-song-content">
                        <div className="request-title-line">
                          <span
                            className="request-title"
                            title={req.title}
                          >
                            {req.title || (isMetadataPending ? 'Syncing metadata...' : `Beatmapset ${req.beatmapset_id}`)}
                          </span>
                          {showModes
                            ? <GuestDifficultySummary stars={req.my_guest_highest_stars} difficulties={req.my_guest_difficulties} />
                            : <StarRatingBadge stars={req.highest_stars} />}
                          {req.priority === 'High' && (
                            <span style={{ 
                              width: '6px', 
                              height: '6px', 
                              borderRadius: '50%', 
                              backgroundColor: 'var(--priority-high)',
                              flexShrink: 0,
                            }} title="High Priority" />
                          )}
                        </div>
                        <div className="request-song-subtitle">
                          {isMetadataPending && !req.artist ? 'Background sync in progress' : <>{req.artist || 'Unknown artist'} • <span style={{ color: 'var(--text-main)' }}>{req.creator || 'Unknown creator'}</span></>}
                        </div>
                      </div>
                    </td>

                    {/* Tags */}
                    {showTags && (
                      <td>
                        {req.tags && req.tags.length > 0 ? (
                          <div className="request-tags">
                            {req.tags.slice(0, 5).map(tag => (
                              <span 
                                key={tag}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  padding: '2px 8px',
                                  backgroundColor: 'var(--hover-bg)',
                                  border: '1px solid var(--border)',
                                  borderRadius: '4px',
                                  fontSize: '10px',
                                  fontWeight: '600',
                                  color: 'var(--text-main)'
                                }}
                              >
                                <Tag size={9} />
                                {tag}
                              </span>
                            ))}
                            {req.tags.length > 5 && (
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', paddingTop: '2px' }}>
                                +{req.tags.length - 5}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                        )}
                      </td>
                    )}

                    {showModes && (
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {(req.gamemodes || []).length > 0
                            ? req.gamemodes.map(mode => <span key={mode} className="badge badge-pending">{mode === 'fruits' ? 'catch' : mode}</span>)
                            : <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>â€”</span>}
                        </div>
                      </td>
                    )}

                    {/* Beatmap Status */}
                    {showBeatmapStatus && <td>
                      <span title={metadataFailed ? req.metadata_sync_error : undefined} className={`badge request-beatmap-badge badge-${metadataFailed ? 'cancelled' : isMetadataPending ? 'pending' : (req.ranked_status || 'Manual').toLowerCase()}`}>
                        {isMetadataPending && <RefreshCw size={10} className="spin" style={{ marginRight: '4px' }} />}
                        {metadataFailed && <AlertCircle size={10} style={{ marginRight: '4px' }} />}
                        {metadataFailed ? 'Sync failed' : isMetadataPending ? 'Syncing' : (req.ranked_status || 'Manual')}
                      </span>
                    </td>}

{/* Inline Request Status Selector */}
                    {showRequestStatus && <td onClick={(e) => e.stopPropagation()}>
                      <div className={`status-badge-select request-table-select badge badge-${req.request_status.toLowerCase()}`}>
                        <select
                          value={req.request_status}
                          onChange={(e) => onUpdateRequest(req.id, { request_status: e.target.value })}
                          className={`status-badge-inner badge badge-${req.request_status.toLowerCase()}`}
                          style={{
                            cursor: 'pointer',
                            textTransform: 'uppercase',
                            fontWeight: '600',
                            WebkitAppearance: 'none',
                            MozAppearance: 'none',
                            appearance: 'none',
                            textAlign: 'center',
                            textAlignLast: 'center',
                            border: 'none',
                            backgroundImage: 'none',
                            backgroundColor: 'transparent',
                          }}
                        >
                          <option className="status-option-accepted" value="Accepted">Accepted</option>
                          <option className="status-option-considering" value="Considering">Considering</option>
                          <option className="status-option-working" value="Working">Working</option>
                          <option className="status-option-completed" value="Completed">Completed</option>
                          <option className="status-option-cancelled" value="Cancelled">Cancelled</option>
                        </select>
                        <div className="request-select-chevron">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </div>
                      </div>
                    </td>}

                    {/* Inline Priority Selector */}
                    {showPriority && <td onClick={(e) => e.stopPropagation()}>
                      <div className={`status-badge-select request-table-select badge badge-priority-${(req.priority || 'Low').toLowerCase()}`}>
                        <select
                          value={req.priority || 'Low'}
                          onChange={(e) => onUpdateRequest(req.id, { priority: e.target.value })}
                          className={`status-badge-inner badge badge-priority-${(req.priority || 'Low').toLowerCase()}`}
                          style={{
                            cursor: 'pointer',
                            textTransform: 'uppercase',
                            fontWeight: '600',
                            WebkitAppearance: 'none',
                            MozAppearance: 'none',
                            appearance: 'none',
                            textAlign: 'center',
                            textAlignLast: 'center',
                            border: 'none',
                            backgroundImage: 'none',
                            backgroundColor: 'transparent',
                          }}
                        >
                          <option value="Low">Low</option>
                          <option value="Medium">Medium</option>
                          <option value="High">High</option>
                        </select>
                        <div className="request-select-chevron">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </div>
                      </div>
                    </td>}

                    {/* Deadline */}
                    {showDeadline && <td>
                      {deadlineInfo ? (
                        <span className="request-deadline" style={{ color: deadlineInfo.color }}>
                          <Calendar size={12} />
                          {deadlineInfo.text}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>}

                    {/* Notes */}
                    {showNotes && <td
                      className="request-notes-cell"
                      title={req.notes || undefined}
                      style={{
                        color: req.notes ? 'var(--text-main)' : 'var(--text-muted)',
                      }}
                    >
                      <span className="request-notes">
                        {req.notes || '—'}
                      </span>
                    </td>}

                    {/* Added Date */}
                    {showAdded && <td className="request-added-date">
                      {req.added_date ? new Date(req.added_date).toLocaleDateString() : '—'}
                    </td>}

                    {/* Actions dropdown/button */}
                    {showActions && <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                      <div className="request-row-actions">
                        <button 
                          onClick={() => onOpenRequest(req)} 
                          title="Open Details"
                          style={{ padding: '6px', borderRadius: '4px', color: 'var(--text-muted)', cursor: 'pointer' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <Edit3 size={14} />
                        </button>
                        <button 
                          onClick={async () => {
                            const confirmed = await onRequestConfirmation({
                              title: 'Delete request?',
                              message: 'This request and its associated categories will be permanently deleted.',
                              confirmLabel: 'Delete request',
                            });
                            if (confirmed) onDeleteRequest(req.id);
                          }} 
                          title="Delete"
                          style={{ padding: '6px', borderRadius: '4px', color: 'var(--text-muted)', cursor: 'pointer' }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(231, 76, 60, 0.1)';
                            e.currentTarget.style.color = 'var(--priority-high)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = 'var(--text-muted)';
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>}
                    </>}

                  </tr>
                );
              })}
              {virtualWindow.bottomSpacerHeight > 0 && (
                <tr className="virtual-spacer-row" aria-hidden="true">
                  <td colSpan={columnCount} style={{ height: `${virtualWindow.bottomSpacerHeight}px` }} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Sticky Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className={`bulk-toolbar-shell${isWindowMaximized ? ' bulk-toolbar-shell-maximized' : ''}`}>
          <div style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--osu-pink)',
          boxShadow: 'var(--shadow-lg)',
          borderRadius: '12px',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }} className="bulk-action-bar">
          <span className="bulk-selection-count" style={{ fontSize: '13px', fontWeight: '600' }}>
            {selectedIds.length} request{selectedIds.length === 1 ? '' : 's'} selected{isBulkStatusUpdating ? ' · updating...' : ''}
          </span>
          
          <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--border)' }} />

          <button
            type="button"
            className="btn-secondary bulk-refresh-button"
            disabled={isBulkDateRefreshing}
            onClick={async () => {
              const ids = [...selectedIds];
              const confirmed = await onRequestConfirmation({
                title: `Refresh dates for ${ids.length} requests?`,
                message: 'This replaces the Date Added value on selected osu!-linked requests. Manual requests will be skipped.',
                confirmLabel: 'Refresh dates',
              });
              if (confirmed && await onBulkRefreshDates?.(ids)) dismissBulkToolbar();
            }}
            style={{ padding: '6px 9px', fontSize: '12px', flexShrink: 0 }}
          >
            <RefreshCw size={12} className={isBulkDateRefreshing ? 'spin' : undefined} style={{ marginRight: '4px' }} />
            <span className="bulk-refresh-label">{isBulkDateRefreshing ? 'Refreshing...' : 'Refresh dates'}</span>
          </button>

          {/* Change Status Dropdown */}
          <div className="bulk-toolbar-control" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <span className="bulk-toolbar-label" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Status:</span>
            <select
              onChange={(e) => {
                if (e.target.value) {
                  const updatedIds = [...selectedIds];
                  void onBulkUpdateStatus(updatedIds, e.target.value).then(started => {
                    if (started) setSelectedIds(current => current.filter(id => !updatedIds.includes(id)));
                  });
                  e.target.value = '';
                }
              }}
              disabled={isBulkStatusUpdating}
              className="input-text bulk-toolbar-select"
              style={{ padding: '4px 8px', fontSize: '12px', width: '110px' }}
            >
              <option value="">Change to...</option>
              <option value="Accepted">Accepted</option>
              <option value="Considering">Considering</option>
              <option value="Working">Working</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>

          {/* Change Priority Dropdown */}
          <div className="bulk-toolbar-control" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <span className="bulk-toolbar-label" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Priority:</span>
            <select
              onChange={(e) => {
                if (e.target.value) {
                  onBulkUpdatePriority(selectedIds, e.target.value);
                  dismissBulkToolbar();
                  e.target.value = '';
                }
              }}
              disabled={isBulkStatusUpdating}
              className="input-text bulk-toolbar-select"
              style={{ padding: '4px 8px', fontSize: '12px', width: '110px' }}
            >
              <option value="">Change to...</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </div>

          {/* Change Request Type */}
          <div className="bulk-toolbar-control" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <span className="bulk-toolbar-label" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Type:</span>
            <select
              onChange={(e) => handleBulkCategoryAction(e, 'move')}
              disabled={isBulkStatusUpdating}
              className="input-text bulk-toolbar-select"
              style={{ padding: '4px 8px', fontSize: '12px', width: '110px' }}
            >
              <option value="">Move to...</option>
              {categoryDefinitions.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <select
              onChange={(e) => handleBulkCategoryAction(e, 'add')}
              disabled={isBulkStatusUpdating}
              className="input-text bulk-toolbar-select"
              style={{ padding: '4px 8px', fontSize: '12px', width: '105px' }}
            >
              <option value="">Add to...</option>
              {categoryDefinitions.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>

          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              className="btn-secondary bulk-tags-button"
              disabled={isBulkStatusUpdating}
              onClick={() => setIsBulkTagsOpen(open => !open)}
              style={{ padding: '6px 9px', fontSize: '12px' }}
            >
              <span className="bulk-tags-label">Add tags{bulkTags.length ? ` (${bulkTags.length})` : ''}</span>
            </button>
            {isBulkTagsOpen && (
              <div className="bulk-tags-popover" style={{ position: 'absolute', right: 0, bottom: 'calc(100% + 8px)', zIndex: 130, padding: '10px', display: 'grid', gap: '8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: 'var(--shadow-lg)' }}>
                <TagInput className="bulk-tag-editor" value={bulkTags} onChange={setBulkTags} suggestions={tagSuggestions} placeholder="Add tags..." compact />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                  <button type="button" className="btn-secondary" onClick={() => { setBulkTags([]); setIsBulkTagsOpen(false); }} style={{ padding: '5px 8px', fontSize: '11px' }}>Cancel</button>
                  <button type="button" className="btn-primary" disabled={bulkTags.length === 0} onClick={async () => {
                    const success = await onBulkAddTags(selectedIds, bulkTags);
                    if (success) {
                      setBulkTags([]);
                      dismissBulkToolbar();
                    }
                  }} style={{ padding: '5px 8px', fontSize: '11px' }}>Add tags</button>
                </div>
              </div>
            )}
          </div>

          <button
            disabled={isBulkStatusUpdating}
            onClick={async () => {
              const confirmed = await onRequestConfirmation({
                title: `Delete ${selectedIds.length} requests?`,
                message: 'The selected requests and their associated categories will be permanently deleted.',
                confirmLabel: 'Delete requests',
              });
              if (confirmed) {
                onBulkDelete(selectedIds);
                dismissBulkToolbar();
              }
            }}
            className="btn-secondary bulk-delete-button"
            style={{ 
              padding: '6px 10px',
              fontSize: '12px', 
              flexShrink: 0,
              color: 'var(--priority-high)',
              borderColor: 'rgba(231, 76, 60, 0.3)',
              backgroundColor: 'rgba(231, 76, 60, 0.05)'
            }}
          >
            <Trash2 size={12} style={{ marginRight: '4px' }} />
            <span className="bulk-delete-label">Delete Selected</span><span className="bulk-delete-label-compact">Delete</span>
          </button>

          </div>
          <button
            type="button"
            aria-label="Close selection toolbar"
            title="Close selection toolbar"
            onClick={dismissBulkToolbar}
            className="bulk-toolbar-close"
          >
            <X size={16} />
          </button>
        </div>
      )}

    </div>
  );
}
