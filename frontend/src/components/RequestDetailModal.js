'use client';

import React, { useState, useEffect } from 'react';
import { 
  X, 
  ExternalLink, 
  Calendar, 
  AlertCircle, 
  Tag, 
  MessageSquare,
  RefreshCw,
  Plus,
  Trash2,
  Clock
} from 'lucide-react';

export default function RequestDetailModal({ 
  request, 
  onClose, 
  onUpdateRequest,
  onForceRefreshBeatmap
}) {
  const [activeRequest, setActiveRequest] = useState(request);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  
  // Local editable states
  const [requestStatus, setRequestStatus] = useState(request.request_status);
  const [priority, setPriority] = useState(request.priority);
  const [deadline, setDeadline] = useState(request.deadline || '');
  const [notes, setNotes] = useState(request.notes || '');
  const [discordLink, setDiscordLink] = useState(request.discord_link || '');
  const [profileLink, setProfileLink] = useState(request.osu_profile_link || '');
  const [newTag, setNewTag] = useState('');
  const [tags, setTags] = useState(request.tags || []);
  
  // Category progress state
  const [categories, setCategories] = useState(
    ['Hitsounds', 'Guest Difficulties', 'Storyboards', 'Others'].map(name => {
      const match = request.categories.find(c => c.category_name === name);
      return {
        name,
        checked: !!match,
        status: match ? match.status : 'Pending',
        otherText: match ? match.other_text : ''
      };
    })
  );

  // Fetch history when modal opens
  useEffect(() => {
    fetchHistory();
  }, [request.id]);

  const fetchHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch(`/api/requests/${request.id}/history`);
      if (res.ok) {
        const data = await res.json();
        setHistoryLogs(data);
      }
    } catch (e) {
      console.error('Error fetching request history:', e);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleMetadataRefresh = async () => {
    if (!request.beatmapset_id) return;
    setIsRefreshingMetadata(true);
    try {
      const res = await fetch('/api/beatmaps/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beatmapset_id: request.beatmapset_id })
      });
      if (res.ok) {
        const resData = await res.json();
        // Trigger parent state refresh
        onForceRefreshBeatmap(request.id);
        alert('Beatmap metadata updated successfully!');
      }
    } catch (e) {
      console.error('Error refreshing beatmap metadata:', e);
    } finally {
      setIsRefreshingMetadata(false);
    }
  };

  const toggleCategory = (index) => {
    setCategories(prev => prev.map((cat, i) => {
      if (i === index) {
        return { ...cat, checked: !cat.checked };
      }
      return cat;
    }));
  };

  const handleCategoryStatusChange = (index, status) => {
    setCategories(prev => prev.map((cat, i) => {
      if (i === index) {
        return { ...cat, status };
      }
      return cat;
    }));
  };

  const handleCategoryOtherTextChange = (index, otherText) => {
    setCategories(prev => prev.map((cat, i) => {
      if (i === index) {
        return { ...cat, otherText };
      }
      return cat;
    }));
  };

  const handleAddTag = (e) => {
    e.preventDefault();
    const cleanTag = newTag.trim();
    if (cleanTag && !tags.includes(cleanTag)) {
      setTags(prev => [...prev, cleanTag]);
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setTags(prev => prev.filter(t => t !== tagToRemove));
  };

  const handleSave = async () => {
    // Format categories payload
    const catsPayload = categories
      .filter(c => c.checked)
      .map(c => ({
        category_name: c.name,
        other_text: c.name === 'Others' ? c.otherText : null,
        status: c.status
      }));

    if (catsPayload.length === 0) {
      alert('Please select at least one request category.');
      return;
    }

    const payload = {
      request_status: requestStatus,
      priority,
      deadline: deadline || null,
      notes: notes || null,
      discord_link: discordLink || null,
      osu_profile_link: profileLink || null,
      categories: catsPayload,
      tags
    };

    await onUpdateRequest(request.id, payload);
    // Reload history to show the save events
    fetchHistory();
    alert('Changes saved successfully!');
  };

  // Duration parser helper (seconds -> mm:ss)
  const formatLength = (seconds) => {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '24px',
      backdropFilter: 'blur(4px)'
    }} onClick={onClose}>
      
      {/* Modal Wrapper */}
      <div 
        style={{
          width: '100%',
          maxWidth: '960px',
          maxHeight: '90vh',
          backgroundColor: 'var(--bg-card)',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'fadeIn 0.2s ease-out'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Cover Photo Header */}
        <div style={{ 
          height: '180px', 
          position: 'relative', 
          backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.2), rgba(0,0,0,0.8)), url(${request.local_cover_path})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          display: 'flex',
          alignItems: 'flex-end',
          padding: '20px 24px',
          borderBottom: '1px solid var(--border)'
        }}>
          {/* Close button */}
          <button 
            onClick={onClose}
            style={{ 
              position: 'absolute', 
              top: '16px', 
              right: '16px', 
              backgroundColor: 'rgba(0,0,0,0.5)', 
              color: 'white', 
              padding: '6px', 
              borderRadius: '50%',
              cursor: 'pointer'
            }}
          >
            <X size={18} />
          </button>

          {/* Heading metadata */}
          <div style={{ color: 'white' }}>
            <h2 style={{ fontSize: '24px', fontWeight: '800', fontFamily: 'var(--font-display)', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
              {request.title}
            </h2>
            <p style={{ opacity: 0.9, fontSize: '14px', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
              by {request.artist} • Mapped by {request.creator}
            </p>
          </div>
        </div>

        {/* Modal Main Content (Scrollable) */}
        <div style={{ overflowY: 'auto', padding: '24px', display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '24px' }}>
          
          {/* LEFT COLUMN: Beatmap Information */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '12px' }}>
                Beatmap Info
              </h3>

              {request.is_osu_link ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <span className={`badge badge-${(request.ranked_status || 'Graveyard').toLowerCase()}`}>
                      {request.ranked_status}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Beatmapset ID: {request.beatmapset_id}
                    </span>
                    <button
                      onClick={handleMetadataRefresh}
                      disabled={isRefreshingMetadata}
                      style={{ 
                        fontSize: '11px', 
                        color: 'var(--osu-pink)', 
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        marginLeft: 'auto'
                      }}
                    >
                      <RefreshCw size={12} className={isRefreshingMetadata ? 'spin' : ''} />
                      {isRefreshingMetadata ? 'Refreshing...' : 'Force Refresh API'}
                    </button>
                  </div>

                  {/* Difficulty Badges / Stars Grid */}
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', 
                    gap: '10px',
                    backgroundColor: 'var(--bg-sidebar)',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)'
                  }}>
                    {request.difficulties && request.difficulties.length > 0 ? (
                      request.difficulties.map((diff, index) => (
                        <div 
                          key={index}
                          style={{
                            padding: '6px 8px',
                            backgroundColor: 'var(--bg-card)',
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            fontSize: '12px'
                          }}
                        >
                          <div style={{ 
                            fontWeight: '600', 
                            whiteSpace: 'nowrap', 
                            overflow: 'hidden', 
                            textOverflow: 'ellipsis',
                            color: 'var(--text-main)',
                            marginBottom: '2px'
                          }} title={diff.name}>
                            {diff.name}
                          </div>
                          <div style={{ color: 'var(--osu-pink)', fontWeight: '700', fontSize: '11px' }}>
                            ★ {diff.stars.toFixed(2)}
                          </div>
                          <div style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column' }}>
                            <span>AR: {diff.ar} • OD: {diff.od}</span>
                            <span>CS: {diff.cs} • HP: {diff.hp}</span>
                            <span>Length: {formatLength(diff.drain)}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', gridColumn: '1 / -1' }}>
                        No difficulty details available.
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{
                  padding: '16px',
                  backgroundColor: 'var(--bg-sidebar)',
                  borderRadius: '8px',
                  border: '1px dashed var(--border)',
                  fontSize: '13px',
                  color: 'var(--text-muted)'
                }}>
                  This is a manually added request. Difficulty metadata is not synced with the osu! API.
                  {request.difficulty_name && (
                    <div style={{ marginTop: '8px', color: 'var(--text-main)', fontWeight: '600' }}>
                      Requested Difficulty: {request.difficulty_name}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quick Links section */}
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '12px' }}>
                Links & Modding Discussion
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {request.beatmapset_id && (
                  <a 
                    href={`https://osu.ppy.sh/beatmapsets/${request.beatmapset_id}/discussion`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      color: 'var(--osu-pink)',
                      fontWeight: '600'
                    }}
                  >
                    <MessageSquare size={14} />
                    <span>osu! Modding & Discussion page</span>
                    <ExternalLink size={12} />
                  </a>
                )}
                {request.osu_profile_link && (
                  <a 
                    href={request.osu_profile_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      color: 'var(--text-main)'
                    }}
                  >
                    <span>Requester Profile Link</span>
                    <ExternalLink size={12} />
                  </a>
                )}
                {request.discord_link && (
                  <a 
                    href={request.discord_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      color: 'var(--req-working)'
                    }}
                  >
                    <span>Discord Conversation / Guild Invite</span>
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>

            {/* Requester Profile Card */}
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '12px' }}>
                Requester Information
              </h3>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                backgroundColor: 'var(--bg-sidebar)',
                borderRadius: '8px',
                border: '1px solid var(--border)'
              }}>
                <img 
                  src={request.requester_avatar || '/uploads/covers/default.jpg'} 
                  alt="avatar" 
                  style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)' }}
                  onError={(e) => {
                    e.target.src = '/uploads/covers/default.jpg';
                  }}
                />
                <div>
                  <div style={{ fontWeight: '700', color: 'var(--text-main)', fontSize: '14px' }}>
                    {request.requester_username || 'Anonymous'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {request.requester_country && (
                      <span style={{ fontWeight: '600', textTransform: 'uppercase' }}>
                        [{request.requester_country}]
                      </span>
                    )}
                    <span>{request.requester_id ? 'osu! ID Cached' : 'Manual Entry'}</span>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN: Request Settings */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', borderLeft: '1px solid var(--border)', paddingLeft: '24px' }}>
            
            {/* Status Select */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                Request Status
              </label>
              <select 
                className="input-text" 
                value={requestStatus} 
                onChange={(e) => setRequestStatus(e.target.value)}
                style={{ fontWeight: '600' }}
              >
                <option value="Accepted">Accepted</option>
                <option value="Working">Working</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>

            {/* Priority Select */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                Priority
              </label>
              <div style={{ display: 'flex', gap: '12px' }}>
                {['Low', 'Medium', 'High'].map(p => (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    style={{
                      flexGrow: 1,
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      backgroundColor: priority === p ? 'var(--hover-bg)' : 'transparent',
                      color: priority === p ? 'var(--osu-pink)' : 'var(--text-main)',
                      fontWeight: priority === p ? '600' : '500',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 0.2s'
                    }}
                  >
                    <span className={`priority-dot priority-dot-${p.toLowerCase()}`} style={{ margin: 0 }} />
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Category checklist & individual statuses */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                Request Categories Progress
              </label>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {categories.map((cat, i) => (
                  <div key={cat.name} style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 12px', backgroundColor: 'var(--bg-sidebar)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label className="checkbox-container" style={{ margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={cat.checked}
                          onChange={() => toggleCategory(i)}
                        />
                        <span className="checkmark"></span>
                        <span style={{ fontSize: '13px' }}>{cat.name}</span>
                      </label>

                      {/* Dropdown status for category progress */}
                      {cat.checked && (
                        <select
                          className="input-text"
                          value={cat.status}
                          onChange={(e) => handleCategoryStatusChange(i, e.target.value)}
                          style={{ padding: '2px 6px', fontSize: '11px', width: '100px', backgroundColor: 'var(--bg-card)' }}
                        >
                          <option value="Pending">Pending</option>
                          <option value="Working">Working</option>
                          <option value="Completed">Completed</option>
                          <option value="Cancelled">Cancelled</option>
                        </select>
                      )}
                    </div>

                    {cat.name === 'Others' && cat.checked && (
                      <input
                        type="text"
                        className="input-text"
                        placeholder="Specify custom type..."
                        value={cat.otherText}
                        onChange={(e) => handleCategoryOtherTextChange(i, e.target.value)}
                        style={{ padding: '4px 8px', fontSize: '12px', backgroundColor: 'var(--bg-card)' }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Deadline */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                Deadline
              </label>
              <input 
                type="date" 
                className="input-text" 
                value={deadline} 
                onChange={(e) => setDeadline(e.target.value)} 
              />
            </div>

            {/* Tags section */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                Tags
              </label>
              
              {/* Active tags badges */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                {tags.map(tag => (
                  <span 
                    key={tag}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      backgroundColor: 'var(--hover-bg)',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: '600'
                    }}
                  >
                    <Tag size={10} />
                    {tag}
                    <button 
                      onClick={() => handleRemoveTag(tag)}
                      style={{ color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex' }}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>

              {/* Add tag form */}
              <form onSubmit={handleAddTag} style={{ display: 'flex', gap: '6px' }}>
                <input 
                  type="text" 
                  className="input-text" 
                  placeholder="New tag..." 
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                />
                <button 
                  type="submit" 
                  className="btn-secondary" 
                  style={{ padding: '4px 10px', display: 'flex', alignItems: 'center' }}
                >
                  <Plus size={14} />
                </button>
              </form>
            </div>

            {/* Notes */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                Notes
              </label>
              <textarea 
                className="input-text" 
                value={notes} 
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Edit notes..."
                style={{ minHeight: '80px', fontSize: '13px', resize: 'vertical' }}
              />
            </div>

            {/* Save changes button */}
            <button onClick={handleSave} className="btn-primary" style={{ marginTop: '10px', justifyContent: 'center' }}>
              Save Changes
            </button>

          </div>

        </div>

        {/* BOTTOM SECTION: Activity History Log */}
        <div style={{ 
          borderTop: '1px solid var(--border)', 
          padding: '20px 24px', 
          backgroundColor: 'var(--bg-sidebar)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
            Activity History Log
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '150px', overflowY: 'auto', paddingRight: '8px' }}>
            {isLoadingHistory ? (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Loading history log...</span>
            ) : historyLogs.length === 0 ? (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No logs recorded.</span>
            ) : (
              historyLogs.map(log => {
                const date = new Date(log.created_at);
                return (
                  <div 
                    key={log.id}
                    style={{ 
                      display: 'flex', 
                      gap: '12px', 
                      fontSize: '12px', 
                      borderBottom: '1px solid var(--border)', 
                      paddingBottom: '6px' 
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)', minWidth: '130px', fontWeight: '500' }}>
                      {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span style={{ color: 'var(--text-main)', fontWeight: '600', textTransform: 'uppercase', fontSize: '10px', minWidth: '80px' }}>
                      [{log.action_type.replace('_', ' ')}]
                    </span>
                    <span style={{ color: 'var(--text-main)' }}>
                      {log.details}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* Local spin loader CSS style injected locally */}
      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
