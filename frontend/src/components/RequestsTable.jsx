import React, { useState, useMemo } from 'react';
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
  Tag
} from 'lucide-react';

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

function SortableHeader({ label, onSort }) {
  return (
    <th onClick={onSort} className="sortable-header" style={{ cursor: 'pointer' }}>
      <span className="sortable-header-content">
        <span>{label}</span>
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
  onBulkUpdatePriority,
  onBulkUpdateCategory,
  onBulkDelete,
  activeCategory,
  sortBy,
  sortOrder,
  onSortChange,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  
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
      const term = searchTerm.toLowerCase();
      result = result.filter(r => 
        (r.title && r.title.toLowerCase().includes(term)) ||
        (r.artist && r.artist.toLowerCase().includes(term)) ||
        (r.creator && r.creator.toLowerCase().includes(term)) ||
        (r.requester_username && r.requester_username.toLowerCase().includes(term)) ||
        (r.notes && r.notes.toLowerCase().includes(term)) ||
        (r.tags && r.tags.some(t => t.toLowerCase().includes(term))) ||
        (r.beatmapset_id && r.beatmapset_id.toString().includes(term))
      );
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

  // Helper to determine which columns to show based on active category
  const getCategoryColumns = () => {
    switch (activeCategory) {
      case 'Guest Difficulties':
        return { showTags: false };
      case 'Storyboards':
      case 'Others':
        return { showTags: true };
      default: // All Requests, Hitsounds
        return { showTags: false };
    }
  };

  const { showTags } = getCategoryColumns();

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
            placeholder="Search song, artist, tags, requester..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ paddingLeft: '32px', fontSize: '13px' }}
          />
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
      </div>

      {/* Main Table Container */}
      <div className="table-container requests-table-container">
        {filteredRequests.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No requests match your current filters.
          </div>
        ) : (
          <table className={`compact-table requests-table${showTags ? ' requests-table-with-tags' : ''}`}>
            <colgroup>
              <col className="request-col-select" />
              <col className="request-col-cover" />
              <col className="request-col-song" />
              {showTags && <col className="request-col-tags" />}
              <col className="request-col-beatmap-status" />
              <col className="request-col-request-status" />
              <col className="request-col-priority" />
              <col className="request-col-deadline" />
              <col className="request-col-notes" />
              <col className="request-col-added" />
              <col className="request-col-actions" />
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
                <th>Cover</th>
                <SortableHeader label="Song / Artist" onSort={() => toggleSort('title')} />
                {showTags && (
                  <th>Tags</th>
                )}
                <SortableHeader label="Beatmap Status" onSort={() => toggleSort('ranked_status')} />
                <SortableHeader label="Request Status" onSort={() => toggleSort('request_status')} />
                <SortableHeader label="Priority" onSort={() => toggleSort('priority')} />
                <SortableHeader label="Deadline" onSort={() => toggleSort('deadline')} />
                <th>Notes</th>
                <SortableHeader label="Added" onSort={() => toggleSort('added_date')} />
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.map(req => {
                const deadlineInfo = getDeadlineInfo(req.deadline);
                const isChecked = selectedIds.includes(req.id);
                


                return (
                  <tr 
                    key={req.id} 
                    onClick={() => onOpenRequest(req)}
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

                    {/* Cover Photo */}
                    <td>
                      <img
                        className="request-cover"
                        src={req.local_cover_path} 
                        alt="cover" 
                        width={56}
                        height={32}
                        onError={(e) => {
                          e.target.src = '/uploads/covers/default.jpg';
                        }}
                      />
                    </td>

                    {/* Metadata (Title + Artist + Creator) */}
                    <td className="request-song-cell">
                      <div className="request-song-content">
                        <div className="request-title-line">
                          <span
                            className="request-title"
                            title={req.title}
                          >
                            {req.title}
                          </span>
                          <StarRatingBadge stars={req.highest_stars} />
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
                          {req.artist} • <span style={{ color: 'var(--text-main)' }}>{req.creator}</span>
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

                    {/* Beatmap Status */}
                    <td>
                      <span className={`badge request-beatmap-badge badge-${(req.ranked_status || 'Manual').toLowerCase()}`}>
                        {req.ranked_status || 'Manual'}
                      </span>
                    </td>

{/* Inline Request Status Selector */}
                    <td onClick={(e) => e.stopPropagation()}>
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
                    </td>

                    {/* Inline Priority Selector */}
                    <td onClick={(e) => e.stopPropagation()}>
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
                    </td>

                    {/* Deadline */}
                    <td>
                      {deadlineInfo ? (
                        <span className="request-deadline" style={{ color: deadlineInfo.color }}>
                          <Calendar size={12} />
                          {deadlineInfo.text}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>

                    {/* Notes */}
                    <td
                      className="request-notes-cell"
                      title={req.notes || undefined}
                      style={{
                        color: req.notes ? 'var(--text-main)' : 'var(--text-muted)',
                      }}
                    >
                      <span className="request-notes">
                        {req.notes || '—'}
                      </span>
                    </td>

                    {/* Added Date */}
                    <td className="request-added-date">
                      {req.added_date ? new Date(req.added_date).toLocaleDateString() : '—'}
                    </td>

                    {/* Actions dropdown/button */}
                    <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
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
                          onClick={() => {
                            if (confirm('Delete this request?')) onDeleteRequest(req.id);
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
                    </td>

                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Sticky Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--osu-pink)',
          boxShadow: 'var(--shadow-lg)',
          borderRadius: '12px',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'nowrap',
          maxWidth: 'calc(100vw - 48px)',
          whiteSpace: 'nowrap',
          overflowX: 'auto',
          zIndex: 100,
        }} className="bulk-action-bar">
          <span style={{ fontSize: '13px', fontWeight: '600' }}>
            {selectedIds.length} requests selected
          </span>
          
          <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--border)' }} />

          {/* Change Status Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Status:</span>
            <select
              onChange={(e) => {
                if (e.target.value) {
                  onBulkUpdateStatus(selectedIds, e.target.value);
                  setSelectedIds([]);
                  e.target.value = '';
                }
              }}
              className="input-text"
              style={{ padding: '4px 8px', fontSize: '12px', width: '110px' }}
            >
              <option value="">Change Status...</option>
              <option value="Accepted">Accepted</option>
              <option value="Considering">Considering</option>
              <option value="Working">Working</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>

          {/* Change Priority Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Priority:</span>
            <select
              onChange={(e) => {
                if (e.target.value) {
                  onBulkUpdatePriority(selectedIds, e.target.value);
                  setSelectedIds([]);
                  e.target.value = '';
                }
              }}
              className="input-text"
              style={{ padding: '4px 8px', fontSize: '12px', width: '110px' }}
            >
              <option value="">Change Priority...</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </div>

          {/* Change Request Type */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Type:</span>
            <select
              onChange={(e) => handleBulkCategoryAction(e, 'move')}
              className="input-text"
              style={{ padding: '4px 8px', fontSize: '12px', width: '110px' }}
            >
              <option value="">Move to...</option>
              <option value="Hitsounds">Hitsounds</option>
              <option value="Guest Difficulties">Guest Difficulties</option>
              <option value="Storyboards">Storyboards</option>
              <option value="Others">Others</option>
            </select>
            <select
              onChange={(e) => handleBulkCategoryAction(e, 'add')}
              className="input-text"
              style={{ padding: '4px 8px', fontSize: '12px', width: '105px' }}
            >
              <option value="">Add to...</option>
              <option value="Hitsounds">Hitsounds</option>
              <option value="Guest Difficulties">Guest Difficulties</option>
              <option value="Storyboards">Storyboards</option>
              <option value="Others">Others</option>
            </select>
          </div>

          <button
            onClick={() => {
              if (confirm(`Are you sure you want to delete ${selectedIds.length} requests?`)) {
                onBulkDelete(selectedIds);
                setSelectedIds([]);
              }
            }}
            className="btn-secondary"
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
            Delete Selected
          </button>

          <button
            onClick={() => setSelectedIds([])}
            style={{ color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}
          >
            <X size={16} />
          </button>
        </div>
      )}

    </div>
  );
}
