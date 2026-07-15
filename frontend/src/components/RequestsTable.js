'use client';

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

export default function RequestsTable({ 
  requestsList, 
  onOpenRequest, 
  onDeleteRequest, 
  onUpdateRequest,
  onBulkUpdateStatus,
  onBulkDelete,
  activeCategory
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  
  // Sorting state
  const [sortBy, setSortBy] = useState('added_date');
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc' or 'desc'

  const toggleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc'); // default to descending for new field
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

      // Handle custom sorting fields
      if (sortBy === 'highest_stars') {
        valA = a.highest_stars || 0;
        valB = b.highest_stars || 0;
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
    priorityFilter('');
    setTagFilter('');
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
      <div className="table-container">
        {filteredRequests.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No requests match your current filters.
          </div>
        ) : (
          <table className="compact-table">
            <thead>
              <tr>
                <th style={{ width: '36px', textAlign: 'center' }}>
                  <input 
                    type="checkbox" 
                    onChange={handleSelectAll} 
                    checked={selectedIds.length > 0 && selectedIds.length === filteredRequests.length}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th style={{ width: '70px' }}>Cover</th>
                <th onClick={() => toggleSort('title')} style={{ cursor: 'pointer' }}>
                  Song / Artist <ArrowUpDown size={12} style={{ marginLeft: '4px', display: 'inline' }} />
                </th>
                <th>Difficulties</th>
                <th onClick={() => toggleSort('highest_stars')} style={{ cursor: 'pointer' }}>
                  Highest Stars <ArrowUpDown size={12} style={{ marginLeft: '4px', display: 'inline' }} />
                </th>
                {activeCategory !== 'All' ? (
                  <th>Category Status</th>
                ) : (
                  <th>Beatmap Status</th>
                )}
                <th>Request Status</th>
                <th onClick={() => toggleSort('deadline')} style={{ cursor: 'pointer' }}>
                  Deadline <ArrowUpDown size={12} style={{ marginLeft: '4px', display: 'inline' }} />
                </th>
                <th onClick={() => toggleSort('added_date')} style={{ cursor: 'pointer' }}>
                  Added <ArrowUpDown size={12} style={{ marginLeft: '4px', display: 'inline' }} />
                </th>
                <th style={{ width: '60px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.map(req => {
                const deadlineInfo = getDeadlineInfo(req.deadline);
                const isChecked = selectedIds.includes(req.id);
                
                // Fetch relevant category status when filtered inside category
                let targetCategoryStatus = null;
                if (activeCategory !== 'All') {
                  const activeCatObj = req.categories.find(c => c.category_name === activeCategory);
                  if (activeCatObj) {
                    targetCategoryStatus = activeCatObj.status;
                  }
                }

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
                        src={req.local_cover_path} 
                        alt="cover" 
                        style={{ width: '56px', height: '32px', borderRadius: '4px', objectFit: 'cover', display: 'block', border: '1px solid var(--border)' }}
                        onError={(e) => {
                          e.target.src = '/uploads/covers/default.jpg';
                        }}
                      />
                    </td>

                    {/* Metadata (Title + Artist + Creator) */}
                    <td>
                      <div>
                        <div style={{ fontWeight: '600', color: 'var(--text-main)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {req.title}
                          {req.priority === 'High' && (
                            <span style={{ 
                              width: '6px', 
                              height: '6px', 
                              borderRadius: '50%', 
                              backgroundColor: 'var(--priority-high)' 
                            }} title="High Priority" />
                          )}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {req.artist} • <span style={{ color: 'var(--text-main)' }}>{req.creator}</span>
                        </div>
                      </div>
                    </td>

                    {/* Diffs Count */}
                    <td>
                      <span style={{ fontSize: '12px' }}>
                        {req.num_difficulties} {req.num_difficulties === 1 ? 'diff' : 'diffs'}
                      </span>
                    </td>

                    {/* Stars */}
                    <td style={{ fontWeight: '600', color: 'var(--osu-pink)', fontSize: '12px' }}>
                      {req.highest_stars > 0 ? `★ ${req.highest_stars.toFixed(2)}` : '—'}
                    </td>

                    {/* Beatmap Status / Specific Category Status */}
                    <td>
                      {activeCategory !== 'All' && targetCategoryStatus ? (
                        <span className={`badge badge-${targetCategoryStatus.toLowerCase()}`} style={{ fontSize: '10px' }}>
                          {targetCategoryStatus}
                        </span>
                      ) : (
                        <span className={`badge badge-${(req.ranked_status || 'Manual').toLowerCase()}`}>
                          {req.ranked_status}
                        </span>
                      )}
                    </td>

                    {/* Inline Request Status Selector */}
                    <td onClick={(e) => e.stopPropagation()}>
                      <select
                        value={req.request_status}
                        onChange={(e) => onUpdateRequest(req.id, { request_status: e.target.value })}
                        className={`badge badge-${req.request_status.toLowerCase()}`}
                        style={{ border: '1px solid var(--border)', cursor: 'pointer', paddingRight: '4px', textTransform: 'capitalize', fontWeight: '600' }}
                      >
                        <option value="Accepted">Accepted</option>
                        <option value="Working">Working</option>
                        <option value="Completed">Completed</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </td>

                    {/* Deadline */}
                    <td>
                      {deadlineInfo ? (
                        <span style={{ color: deadlineInfo.color, fontWeight: '600', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Calendar size={12} />
                          {deadlineInfo.text}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>

                    {/* Added Date */}
                    <td style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                      {new Date(req.added_date).toLocaleDateString()}
                    </td>

                    {/* Actions dropdown/button */}
                    <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
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
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          zIndex: 100,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <span style={{ fontSize: '13px', fontWeight: '600' }}>
            {selectedIds.length} requests selected
          </span>
          
          <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--border)' }} />

          {/* Change Status Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
              style={{ padding: '4px 8px', fontSize: '12px', width: '120px' }}
            >
              <option value="">Change Status...</option>
              <option value="Accepted">Accepted</option>
              <option value="Working">Working</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
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
              padding: '6px 12px', 
              fontSize: '12px', 
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
            style={{ color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

    </div>
  );
}
