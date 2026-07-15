'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
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
  
  for (let i = 0; i < STAR_DIFFICULTY_SPECTRUM.length - 1; i++) {
    const current = STAR_DIFFICULTY_SPECTRUM[i];
    const next = STAR_DIFFICULTY_SPECTRUM[i + 1];
    
    if (stars >= current.stars && stars <= next.stars) {
      const ratio = (stars - current.stars) / (next.stars - current.stars);
      return interpolateColor(current.color, next.color, ratio);
    }
  }
  
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

function getStarDifficultyTextColor(stars) {
  if (stars < STAR_TEXT_CUTOFF) return 'rgba(0,0,0,0.75)';
  if (stars < STAR_TEXT_GRADIENT_CUTOFF) return '#ff6600';

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
  const hex1 = color1.replace('#', '');
  const hex2 = color2.replace('#', '');
  
  const r1 = parseInt(hex1.substring(0, 2), 16);
  const g1 = parseInt(hex1.substring(2, 4), 16);
  const b1 = parseInt(hex1.substring(4, 6), 16);
  
  const r2 = parseInt(hex2.substring(0, 2), 16);
  const g2 = parseInt(hex2.substring(2, 4), 16);
  const b2 = parseInt(hex2.substring(4, 6), 16);
  
  const r = Math.round(r1 + (r2 - r1) * ratio);
  const g = Math.round(g1 + (g2 - g1) * ratio);
  const b = Math.round(b1 + (b2 - b1) * ratio);
  
  const toHex = (c) => c.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export default function RequestDetailModal({ 
  request, 
  onClose, 
  onUpdateRequest,
  onForceRefreshBeatmap,
  connectedAccount
}) {
  const [activeRequest, setActiveRequest] = useState(request);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  
  // Local editable states
  const [requestStatus, setRequestStatus] = useState(request.request_status);
  const [priority, setPriority] = useState(request.priority);
  const [deadline, setDeadline] = useState(request.deadline || '');
  const [addedDate, setAddedDate] = useState(request.added_date ? request.added_date.split(' ')[0] : '');
  const [guestDifficultyTargetSR, setGuestDifficultyTargetSR] = useState(request.guest_difficulty_target_sr || '');
  const [guestDifficultyName, setGuestDifficultyName] = useState(request.guest_difficulty_name || '');
  const [isEditingDate, setIsEditingDate] = useState(false);
  const [isEditingDeadline, setIsEditingDeadline] = useState(false);
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

  const fetchHistory = useCallback(async () => {
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
  }, [request.id]);

  // Fetch history when the selected request changes.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchHistory();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [fetchHistory]);

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
    const catsPayload = categories
      .filter(c => c.checked)
      .map(c => ({
        category_name: c.name,
        other_text: c.name === 'Others' ? c.otherText : null,
      }));

    const guestDiffTargetSR = categories.some(c => c.checked && c.name === 'Guest Difficulties') ? (parseFloat(guestDifficultyTargetSR) || null) : null;

    const payload = {
      request_status: requestStatus,
      priority,
      deadline: deadline || null,
      added_date: addedDate || null,
      guest_difficulty_target_sr: guestDiffTargetSR,
      guest_difficulty_name: guestDifficultyName || null,
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
                    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', 
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
                            {diff.creator_name && (
                              <span style={{ color: 'var(--text-muted)', marginTop: '2px', borderTop: '1px solid var(--border)', paddingTop: '2px' }}>
                                Creator: {diff.creator_name}
                              </span>
                            )}
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

            {request.categories.some(c => c.category_name === 'Guest Difficulties') && (
                <div style={{ marginTop: '20px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '12px' }}>
                    My Guest Difficulty
                  </h3>
                  {request.user_difficulty ? (
                    // Show the detected difficulty belonging to the connected user
                    (() => {
                      const diff = request.user_difficulty;
                      const color = getStarDifficultyColor(diff.stars);
                      const textColor = getStarDifficultyTextColor(diff.stars);
                      const [r, g, b] = [parseInt(color.slice(1,3),16), parseInt(color.slice(3,5),16), parseInt(color.slice(5,7),16)];
                      return (
                        <div style={{
                          padding: '12px 14px',
                          backgroundColor: 'var(--bg-sidebar)',
                          borderRadius: '8px',
                          border: `1px solid rgba(${r}, ${g}, ${b}, 0.4)`
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '3px 10px',
                              borderRadius: '12px',
                              fontSize: '13px',
                              fontWeight: '700',
                              background: `rgba(${r}, ${g}, ${b}, 0.7)`,
                              color: textColor,
                              border: `1px solid rgba(${r}, ${g}, ${b}, 1)`,
                            }}>
                              ★ {diff.stars.toFixed(2)}
                            </span>
                            <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={diff.name}>
                              {diff.name}
                            </span>
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                            <span>AR: {diff.ar} • OD: {diff.od}</span>
                            <span>CS: {diff.cs} • HP: {diff.hp}</span>
                            <span>Length: {formatLength(diff.drain)}</span>
                            <span style={{ color: 'var(--osu-pink)', marginTop: '2px' }}>Creator: {diff.creator_name || connectedAccount?.username || 'You'}</span>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    // No difficulty found — show target SR or a message
                    <div style={{
                      padding: '12px 14px',
                      backgroundColor: 'var(--bg-sidebar)',
                      borderRadius: '8px',
                      border: '1px dashed var(--border)'
                    }}>
                      {request.guest_difficulty_target_sr ? (
                        <>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Target SR (not yet uploaded)</div>
                          {(() => {
                            const color = getStarDifficultyColor(request.guest_difficulty_target_sr);
                            const textColor = getStarDifficultyTextColor(request.guest_difficulty_target_sr);
                            const [r, g, b] = [parseInt(color.slice(1,3),16), parseInt(color.slice(3,5),16), parseInt(color.slice(5,7),16)];
                            return (
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '3px 10px',
                                borderRadius: '12px',
                                fontSize: '13px',
                                fontWeight: '700',
                                background: `rgba(${r}, ${g}, ${b}, 0.2)`,
                                color: textColor,
                                border: `1px solid rgba(${r}, ${g}, ${b}, 0.5)`,
                              }}>
                                ★ {parseFloat(request.guest_difficulty_target_sr).toFixed(2)}
                              </span>
                            );
                          })()}
                        </>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          No difficulty matched yet. Set a target SR or assign a difficulty name below.
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

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
                <Image
                  src={request.requester_avatar || '/uploads/covers/default.jpg'} 
                  alt="avatar" 
                  width={40}
                  height={40}
                  unoptimized
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
                    <span>{request.requester_is_creator ? 'Mapper (auto)' : (request.requester_id ? 'osu! ID Cached' : 'Manual Entry')}</span>
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



            {/* Deadline */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                Deadline
              </label>
              {isEditingDeadline ? (
                <input
                  type="date"
                  className="input-text"
                  value={deadline}
                  autoFocus
                  onChange={(e) => setDeadline(e.target.value)}
                  onBlur={() => setIsEditingDeadline(false)}
                />
              ) : (
                <div
                  onClick={() => setIsEditingDeadline(true)}
                  className="input-text"
                  style={{ cursor: 'pointer', color: deadline ? 'var(--text-main)' : 'var(--text-muted)', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <span>{deadline ? new Date(deadline).toLocaleDateString() : 'No deadline set'}</span>
                  <Calendar size={14} style={{ opacity: 0.6 }} />
                </div>
              )}
            </div>

            {/* Date Added */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                Date Added
              </label>
              {isEditingDate ? (
                <input
                  type="date"
                  className="input-text"
                  value={addedDate}
                  autoFocus
                  onChange={(e) => setAddedDate(e.target.value)}
                  onBlur={() => setIsEditingDate(false)}
                />
              ) : (
                <div
                  onClick={() => setIsEditingDate(true)}
                  className="input-text"
                  style={{ cursor: 'pointer', color: addedDate ? 'var(--text-main)' : 'var(--text-muted)', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <span>{request.added_date ? new Date(request.added_date).toLocaleDateString() : 'No date set'}</span>
                  <Calendar size={14} style={{ opacity: 0.6 }} />
                </div>
              )}
            </div>

            {/* Category checklist */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                Request Categories
              </label>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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

                    {cat.name === 'Guest Difficulties' && cat.checked && (
                      <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div>
                          <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                            Target SR (if not yet uploaded)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="input-text"
                            placeholder="e.g. 6.58"
                            value={guestDifficultyTargetSR}
                            onChange={(e) => setGuestDifficultyTargetSR(e.target.value)}
                            style={{ padding: '4px 8px', fontSize: '12px', backgroundColor: 'var(--bg-card)' }}
                          />
                        </div>
                        {request.is_osu_link && !request.user_difficulty && (
                          <div>
                            <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                              Assign Difficulty Name
                            </label>
                            <input
                              type="text"
                              className="input-text"
                              placeholder="e.g. Mahiru's Expert"
                              value={guestDifficultyName}
                              onChange={(e) => setGuestDifficultyName(e.target.value)}
                              style={{ padding: '4px 8px', fontSize: '12px', backgroundColor: 'var(--bg-card)' }}
                            />
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px', display: 'block' }}>
                              Match a difficulty by name when creator ID isn&apos;t cached yet.
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
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
