import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  X, 
  ExternalLink, 
  Calendar, 
  AlertCircle, 
  Link,
  MessageSquare,
  RefreshCw,
  Plus,
  Trash2,
  Clock
} from 'lucide-react';
import { countryCodeToFlag } from '../utils/countryFlag';
import TagInput from './TagInput';
import {
  addUploadedGuestDifficulty,
  createManualGuestDifficulty,
  isDifficultySelected,
  isUploadedGuestDifficulty,
  normalizeGamemode,
} from '../utils/guestDifficulties';

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

function dateInputValue(value) {
  if (!value || value === 0 || value === '0') return '';
  const text = String(value).split(/[ T]/)[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function getDifficultyCreatorNames(difficulty, fallback = '') {
  if (Array.isArray(difficulty.creator_names) && difficulty.creator_names.length > 0) {
    return difficulty.creator_names.filter(Boolean);
  }

  if (difficulty.creator_name) return [difficulty.creator_name];
  return fallback ? [fallback] : [];
}

function formatLength(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function DifficultyStatLines({ difficulty }) {
  const mode = difficulty.mode === 'fruits' ? 'catch' : (difficulty.mode || 'osu');
  const value = (label, raw) => `${label}: ${raw ?? '—'}`;
  const modeSettings = mode === 'mania'
    ? [value('Keys', difficulty.cs), value('OD', difficulty.od), value('HP', difficulty.hp)]
    : mode === 'taiko'
      ? [value('OD', difficulty.od), value('HP', difficulty.hp)]
      : [value('AR', difficulty.ar), value('OD', difficulty.od), value('CS', difficulty.cs), value('HP', difficulty.hp)];
  return <>
    <span>Mode: {mode}</span>
    <span>{modeSettings.join(' • ')}</span>
    <span>BPM: {difficulty.bpm ?? '—'} • Length: {formatLength(difficulty.drain)}</span>
  </>;
}

function DifficultyModeIcon({ mode }) {
  const normalizedMode = normalizeGamemode(mode);
  const label = normalizedMode === 'fruits' ? 'catch' : normalizedMode;
  const shapes = {
    osu: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /></>,
    taiko: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
    fruits: <><circle cx="9" cy="14" r="4" /><circle cx="15" cy="14" r="4" /><path d="M12 10c0-3 2-4 4-4" /></>,
    mania: <><rect x="5" y="5" width="4" height="4" /><rect x="10" y="5" width="4" height="4" /><rect x="15" y="5" width="4" height="4" /><rect x="5" y="10" width="4" height="4" /><rect x="10" y="10" width="4" height="4" /><rect x="15" y="10" width="4" height="4" /><rect x="5" y="15" width="4" height="4" /><rect x="10" y="15" width="4" height="4" /><rect x="15" y="15" width="4" height="4" /></>,
  };
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label} title={label}>{shapes[normalizedMode]}</svg>;
}

export default function RequestDetailModal({ 
  request, 
  onClose, 
  onUpdateRequest,
  onLinkManualRequest,
  onChangeMapset,
  onForceRefreshBeatmap,
  connectedAccount,
  onNotify,
  categoryDefinitions = [],
  tagSuggestions = [],
}) {
  const [activeRequest, setActiveRequest] = useState(request);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  const [isRefreshingAddedDate, setIsRefreshingAddedDate] = useState(false);
  const [isLinkingBeatmap, setIsLinkingBeatmap] = useState(false);
  const [isChangingMapset, setIsChangingMapset] = useState(false);
  const [showMapsetChange, setShowMapsetChange] = useState(false);
  const [beatmapLink, setBeatmapLink] = useState('');
  const [replacementMapsetLink, setReplacementMapsetLink] = useState('');
  const [isAddingDifficulties, setIsAddingDifficulties] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isMetadataPending = request.metadata_sync_status === 'Pending' || request.metadata_sync_status === 'Processing';
  
  // Local editable states
  const [requestStatus, setRequestStatus] = useState(request.request_status);
  const [priority, setPriority] = useState(request.priority || 'Low');
  const [deadline, setDeadline] = useState(dateInputValue(request.deadline));
  const [addedDate, setAddedDate] = useState(dateInputValue(request.added_date));
  const [artist, setArtist] = useState(request.artist || '');
  const [title, setTitle] = useState(request.title || '');
  const [creator, setCreator] = useState(request.creator || '');
  const [difficultyName, setDifficultyName] = useState(request.difficulty_name || '');
  const [requesterUsername, setRequesterUsername] = useState(request.requester_username || '');
  const deadlineInputRef = useRef(null);
  const addedDateInputRef = useRef(null);
  const [guestDifficulties, setGuestDifficulties] = useState(() => request.guest_difficulties?.length
    ? request.guest_difficulties.map(row => ({ ...row, target_sr: row.target_sr ?? '' }))
    : [{ gamemode: 'osu', difficulty_name: request.guest_difficulty_name || '', target_sr: request.guest_difficulty_target_sr || '' }]);
  const [isEditingDate, setIsEditingDate] = useState(false);
  const [isEditingDeadline, setIsEditingDeadline] = useState(false);
  const [notes, setNotes] = useState(request.notes || '');
  const [discordLink, setDiscordLink] = useState(request.discord_link || '');
  const [profileLink, setProfileLink] = useState(request.osu_profile_link || '');
  const [tags, setTags] = useState(request.tags || []);
  
  // Category progress state
  const [categories, setCategories] = useState(
    categoryDefinitions.map(definition => {
      const match = request.categories.find(c => c.category_id === definition.id || c.category_name === definition.name);
      return {
        id: definition.id,
        name: definition.name,
        systemKey: definition.system_key,
        viewType: definition.view_type,
        checked: !!match,
        status: match ? match.status : 'Pending',
        otherText: match ? match.other_text : ''
      };
    })
  );

  useEffect(() => {
    const definitions = [...categoryDefinitions];
    request.categories.forEach(requestCategory => {
      if (!definitions.some(definition => definition.id === requestCategory.category_id)) {
        definitions.push({
          id: requestCategory.category_id,
          name: requestCategory.category_name,
          system_key: requestCategory.system_key,
          view_type: requestCategory.view_type || 'tagged',
          archived: requestCategory.is_active === 0,
        });
      }
    });
    setCategories(current => definitions.map(definition => {
      const existing = current.find(category => category.id === definition.id);
      if (existing) return { ...existing, name: definition.name, systemKey: definition.system_key, viewType: definition.view_type };
      const match = request.categories.find(category => category.category_id === definition.id || category.category_name === definition.name);
      return {
        id: definition.id,
        name: definition.name,
        systemKey: definition.system_key,
        viewType: definition.view_type,
        checked: Boolean(match),
        status: match?.status || 'Pending',
        otherText: match?.other_text || '',
        archived: Boolean(definition.archived),
      };
    }));
  }, [categoryDefinitions, request.categories]);

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
        await res.json();
        const refreshedBeatmap = await fetch(`/api/beatmaps/${request.beatmapset_id}?cacheOnly=1`);
        const refreshedData = refreshedBeatmap.ok ? await refreshedBeatmap.json() : null;
        // Refresh the request summary and replace this modal's cached difficulty list.
        await onForceRefreshBeatmap?.(request.id, refreshedData?.difficulties);
        onNotify?.('Beatmap metadata updated successfully!', 'success');
      } else {
        const error = await res.json().catch(() => ({}));
        onNotify?.(error.error || 'Could not refresh beatmap metadata.', 'error');
      }
    } catch (e) {
      console.error('Error refreshing beatmap metadata:', e);
    } finally {
      setIsRefreshingMetadata(false);
    }
  };

  const handleRefreshAddedDate = async () => {
    if (!request.is_osu_link || !request.beatmapset_id || isRefreshingAddedDate) return;
    setIsRefreshingAddedDate(true);
    try {
      const response = await fetch(`/api/requests/${request.id}/refresh-date`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not refresh the date.');
      setAddedDate(dateInputValue(result.added_date));
      onForceRefreshBeatmap();
      onNotify?.(result.message, 'success');
    } catch (error) {
      onNotify?.(error.message || 'Could not refresh the date.', 'error');
    } finally {
      setIsRefreshingAddedDate(false);
    }
  };

  const handleLinkBeatmap = async () => {
    if (!beatmapLink.trim() || isLinkingBeatmap) return;
    setIsLinkingBeatmap(true);
    try {
      const result = await onLinkManualRequest?.(request.id, beatmapLink.trim());
      if (result?.ok) setBeatmapLink('');
    } finally {
      setIsLinkingBeatmap(false);
    }
  };

  const handleChangeMapset = async () => {
    if (!replacementMapsetLink.trim() || isChangingMapset) return;
    setIsChangingMapset(true);
    try {
      const result = await onChangeMapset?.(request.id, replacementMapsetLink.trim());
      if (result?.ok) {
        setReplacementMapsetLink('');
        setShowMapsetChange(false);
      }
    } finally {
      setIsChangingMapset(false);
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

  const handleSave = async () => {
    if (isSaving) return;

    const catsPayload = categories
      .filter(c => c.checked)
      .map(c => ({
        category_id: c.id,
        category_name: c.name,
        other_text: c.systemKey === 'others' ? c.otherText : null,
        status: c.status || 'Pending',
      }));

    const hasGuestCategory = categories.some(c => c.checked && (c.systemKey === 'guest_difficulties' || c.viewType === 'guest_difficulties'));

    const payload = {
      request_status: requestStatus,
      priority,
      deadline: deadline || null,
      added_date: addedDate || null,
      guest_difficulties: hasGuestCategory ? guestDifficulties : [],
      notes: notes || null,
      discord_link: discordLink || null,
      osu_profile_link: profileLink || null,
      ...(request.is_osu_link ? {} : {
        non_osu_artist: artist.trim(),
        non_osu_title: title.trim(),
        non_osu_creator: creator.trim(),
        non_osu_difficulty: difficultyName.trim() || null,
         requester_username: requesterUsername.trim() || creator.trim() || 'Anonymous'
      }),
      categories: catsPayload,
      tags
    };

    setIsSaving(true);
    try {
      const didSave = await onUpdateRequest(request.id, payload);
      if (didSave) {
        // Reload history to show the save events without blocking the editor.
        void fetchHistory();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const uploadedGuestDifficulties = guestDifficulties.filter(isUploadedGuestDifficulty);
  const manualGuestDifficulties = guestDifficulties.filter(row => !isUploadedGuestDifficulty(row));
  const hasGuestDifficultyCategory = categories.some(category => category.checked && (
    category.systemKey === 'guest_difficulties' || category.viewType === 'guest_difficulties'
  ));
  const toggleUploadedDifficulty = (difficulty) => {
    setGuestDifficulties(rows => isDifficultySelected(rows, difficulty.id)
      ? rows.filter(row => Number(row.beatmap_id) !== Number(difficulty.id))
      : addUploadedGuestDifficulty(rows, difficulty));
  };

  const requesterProfileUrl = request.osu_profile_link || (request.requester_id ? `https://osu.ppy.sh/users/${request.requester_id}` : null);
  const RequesterCard = requesterProfileUrl ? 'a' : 'div';

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
          maxWidth: '1280px',
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
          flexShrink: 0,
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
              {request.title || (isMetadataPending ? 'Syncing beatmap metadata...' : `Beatmapset ${request.beatmapset_id}`)}
            </h2>
            <p style={{ opacity: 0.9, fontSize: '14px', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
              {request.artist ? `by ${request.artist} • Mapped by ${request.creator || 'Unknown'}` : 'Metadata will appear when background synchronization completes.'}
            </p>
          </div>
        </div>

        <div className="request-modal-body" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div className="request-modal-main" style={{ display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0 }}>
            {/* Modal Main Content (Scrollable) */}
            <div className="request-modal-content" style={{ overflowY: 'auto', padding: '24px', display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)', gap: '24px' }}>
          
          {/* LEFT COLUMN: Beatmap Information */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '12px' }}>
                Beatmap Info
              </h3>

              {request.is_osu_link ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <span className={`badge badge-${(request.ranked_status || 'Graveyard').toLowerCase()}`}>
                      {isMetadataPending ? 'Syncing' : request.metadata_sync_status === 'Failed' ? 'Sync failed' : request.ranked_status}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Beatmapset ID: {request.beatmapset_id}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto' }}>
                      <button
                        type="button"
                        onClick={() => setShowMapsetChange(current => !current)}
                        disabled={isRefreshingMetadata || isMetadataPending || isChangingMapset}
                        style={{ fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer' }}
                      >
                        Change Mapset
                      </button>
                      <button
                        onClick={handleMetadataRefresh}
                        disabled={isRefreshingMetadata || isMetadataPending || isChangingMapset}
                        style={{
                          fontSize: '11px',
                          color: 'var(--osu-pink)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <RefreshCw size={12} className={isRefreshingMetadata ? 'spin' : ''} />
                        {isMetadataPending ? 'Sync queued' : isRefreshingMetadata ? 'Refreshing...' : 'Force Refresh API'}
                      </button>
                    </div>
                  </div>

                  {showMapsetChange && (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input
                        className="input-text"
                        value={replacementMapsetLink}
                        onChange={event => setReplacementMapsetLink(event.target.value)}
                        placeholder="New beatmapset ID or osu! link"
                        disabled={isChangingMapset}
                        aria-label="New beatmapset ID or osu! link"
                      />
                      <button type="button" className="btn-primary" onClick={handleChangeMapset} disabled={!replacementMapsetLink.trim() || isChangingMapset} style={{ flexShrink: 0 }}>
                        {isChangingMapset ? 'Changing...' : 'Replace'}
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => { setShowMapsetChange(false); setReplacementMapsetLink(''); }} disabled={isChangingMapset} style={{ flexShrink: 0 }}>Cancel</button>
                    </div>
                  )}

                  {hasGuestDifficultyCategory && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Select uploaded difficulties you are responsible for.</span>
                      <button type="button" className={isAddingDifficulties ? 'btn-primary' : 'btn-secondary'} onClick={() => setIsAddingDifficulties(current => !current)} style={{ marginLeft: 'auto', padding: '5px 8px', fontSize: '11px' }}>
                        {isAddingDifficulties ? 'Done selecting' : 'Add Difficulties'}
                      </button>
                    </div>
                  )}

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
                      request.difficulties.map((diff, index) => {
                        const creatorLabel = getDifficultyCreatorNames(diff).join(', ');
                        const selected = isDifficultySelected(guestDifficulties, diff.id);
                        return (
                          <div
                            key={index}
                            role={isAddingDifficulties && hasGuestDifficultyCategory ? 'button' : undefined}
                            tabIndex={isAddingDifficulties && hasGuestDifficultyCategory ? 0 : undefined}
                            aria-pressed={isAddingDifficulties && hasGuestDifficultyCategory ? selected : undefined}
                            onClick={isAddingDifficulties && hasGuestDifficultyCategory ? () => toggleUploadedDifficulty(diff) : undefined}
                            onKeyDown={isAddingDifficulties && hasGuestDifficultyCategory ? (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                toggleUploadedDifficulty(diff);
                              }
                            } : undefined}
                            style={{
                              padding: '6px 8px',
                              backgroundColor: selected ? 'rgba(255, 102, 170, 0.12)' : 'var(--bg-card)',
                              border: selected ? '1px solid var(--osu-pink)' : '1px solid var(--border)',
                              borderRadius: '6px',
                              fontSize: '12px',
                              cursor: isAddingDifficulties && hasGuestDifficultyCategory ? 'pointer' : 'default',
                              boxShadow: selected ? '0 0 0 1px rgba(255, 102, 170, 0.18)' : 'none',
                            }}
                          >
                          <div style={{ 
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontWeight: '600', 
                            whiteSpace: 'nowrap', 
                            overflow: 'hidden', 
                            textOverflow: 'ellipsis',
                            color: 'var(--text-main)',
                            marginBottom: '2px'
                          }} title={diff.name}>
                            <DifficultyModeIcon mode={diff.mode} />
                            {diff.name}
                          </div>
                          <div style={{ color: 'var(--osu-pink)', fontWeight: '700', fontSize: '11px' }}>
                            ★ {diff.stars.toFixed(2)}
                          </div>
                          <div style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column' }}>
                            <DifficultyStatLines difficulty={diff} />
                            {creatorLabel && (
                              <span
                                title={`Creator: ${creatorLabel}`}
                                style={{
                                  display: 'block',
                                  color: 'var(--text-muted)',
                                  marginTop: '2px',
                                  borderTop: '1px solid var(--border)',
                                  paddingTop: '2px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                Creator: {creatorLabel}
                              </span>
                            )}
                          </div>
                          </div>
                        );
                      })
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', gridColumn: '1 / -1' }}>
                        {isMetadataPending ? 'Difficulty details are syncing in the background.' : 'No difficulty details available.'}
                      </span>
                    )}
                  </div>
                  {isAddingDifficulties && hasGuestDifficultyCategory && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {uploadedGuestDifficulties.length} uploaded {uploadedGuestDifficulties.length === 1 ? 'difficulty' : 'difficulties'} selected. Save the request to persist these changes.
                    </span>
                  )}
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
                  <div style={{ display: 'grid', gap: '10px' }}>
                    <span>Manual request details</span>
                    {[['Artist', artist, setArtist], ['Title', title, setTitle], ['Creator', creator, setCreator], ['Difficulty', difficultyName, setDifficultyName], ['Requester', requesterUsername, setRequesterUsername]].map(([label, value, setter]) => (
                      <label key={label} style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                        {label}
                        <input className="input-text" value={value} onChange={(e) => setter(e.target.value)} style={{ marginTop: '4px' }} />
                      </label>
                    ))}
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px', display: 'grid', gap: '6px' }}>
                      <label style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Uploaded osu! beatmap link</label>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <input className="input-text" value={beatmapLink} onChange={(event) => setBeatmapLink(event.target.value)} placeholder="https://osu.ppy.sh/beatmapsets/..." disabled={isLinkingBeatmap} />
                        <button type="button" className="btn-secondary" onClick={handleLinkBeatmap} disabled={!beatmapLink.trim() || isLinkingBeatmap} style={{ flexShrink: 0 }}>
                          {isLinkingBeatmap ? 'Linking...' : 'Link to osu!'}
                        </button>
                      </div>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Preserves this request's tags, statuses, notes, deadline, and categories.</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {request.categories.some(c => c.system_key === 'guest_difficulties' || c.view_type === 'guest_difficulties' || c.category_name === 'Guest Difficulties') && (
                <div style={{ marginTop: '20px', minWidth: 0 }}>
                  <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '12px' }}>
                    My Guest Difficulties
                  </h3>
                  <div style={{ maxHeight: '360px', overflowY: 'auto', paddingRight: '4px' }}>
                  {request.user_difficulty ? (
                    // Show the detected difficulty belonging to the connected user
                    (() => {
                      const diff = request.user_difficulty;
                      const creatorLabel = getDifficultyCreatorNames(diff, connectedAccount?.username || 'You').join(', ');
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
                          <div style={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', alignItems: 'center', gap: '8px', width: '100%', minWidth: 0, marginBottom: '6px' }}>
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
                              ★ {Number(diff.stars || 0).toFixed(2)}
                            </span>
                            <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: '13px', fontWeight: '600', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={diff.name}>
                              {diff.name}
                            </span>
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                            <DifficultyStatLines difficulty={diff} />
                            <span
                              title={`Creator: ${creatorLabel}`}
                              style={{
                                display: 'block',
                                color: 'var(--osu-pink)',
                                marginTop: '2px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Creator: {creatorLabel}
                            </span>
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
                  {(request.my_guest_difficulties || []).slice(1).map((difficulty, index) => {
                    const creatorLabel = getDifficultyCreatorNames(difficulty, connectedAccount?.username || 'You').join(', ');
                    const color = getStarDifficultyColor(Number(difficulty.stars) || 0);
                    const textColor = getStarDifficultyTextColor(Number(difficulty.stars) || 0);
                    const [r, g, b] = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
                    return (
                      <div key={difficulty.id || difficulty.assignment_id || `${difficulty.mode}-${difficulty.name}-${index}`} style={{
                        marginTop: '7px',
                        padding: '12px 14px',
                        backgroundColor: 'var(--bg-sidebar)',
                        borderRadius: '8px',
                        border: `1px solid rgba(${r}, ${g}, ${b}, 0.4)`,
                        minWidth: 0,
                      }}>
                        <div style={{ display: 'grid', gridTemplateColumns: difficulty.pending ? 'max-content minmax(0, 1fr) max-content' : 'max-content minmax(0, 1fr)', alignItems: 'center', gap: '8px', width: '100%', minWidth: 0, marginBottom: '6px' }}>
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
                            flexShrink: 0,
                          }}>
                            ★ {Number(difficulty.stars || 0).toFixed(2)}
                          </span>
                          <span title={difficulty.name} style={{ flex: '1 1 auto', minWidth: 0, fontSize: '13px', fontWeight: '600', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {difficulty.name || 'Unnamed difficulty'}
                          </span>
                          {difficulty.pending && <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: 'auto' }}>pending</span>}
                        </div>
                        {!difficulty.pending && (
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                            <DifficultyStatLines difficulty={difficulty} />
                            {creatorLabel && (
                              <span title={`Creator: ${creatorLabel}`} style={{ display: 'block', color: 'var(--osu-pink)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                Creator: {creatorLabel}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </div>
              )}

              {/* Quick Links section */}
              <div>
              <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '12px' }}>
                Links & Modding Discussion
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {!request.is_osu_link && request.input_link && (
                  <a
                    href={request.input_link}
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
                    <Link size={14} />
                    <span>Inputed Link</span>
                    <ExternalLink size={12} />
                  </a>
                )}
                {request.beatmapset_id && (
                  <a
                    href={`https://osu.ppy.sh/beatmapsets/${request.beatmapset_id}`}
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
                    <Link size={14} />
                    <span>osu! beatmap page</span>
                    <ExternalLink size={12} />
                  </a>
                )}
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
              <RequesterCard
                {...(requesterProfileUrl ? {
                  href: requesterProfileUrl,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  'aria-label': `Open ${request.requester_username || 'requester'}'s osu! profile`
                } : {})}
                style={{
                 display: 'flex',
                 alignItems: 'center',
                 gap: '12px',
                padding: '12px 16px',
                backgroundColor: 'var(--bg-sidebar)',
                borderRadius: '8px',
                 border: '1px solid var(--border)',
                 color: 'inherit',
                 textDecoration: 'none',
                 cursor: requesterProfileUrl ? 'pointer' : 'default'
               }}>
                {request.requester_avatar ? (
                  <img
                    src={request.requester_avatar}
                    alt="avatar"
                    width={40}
                    height={40}
                    style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)' }}
                    onError={(e) => {
                      e.currentTarget.style.visibility = 'hidden';
                    }}
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    style={{ width: '40px', height: '40px', borderRadius: '50%', border: '1px solid var(--border)', backgroundColor: 'transparent' }}
                  />
                )}
                 <div>
                   <div style={{ fontWeight: '700', color: 'var(--text-main)', fontSize: '14px' }}>
                     {request.requester_username || 'Anonymous'}
                   </div>
                   <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {request.requester_country && (
                      <span
                        title={request.requester_country.toUpperCase()}
                        aria-label={`Country: ${request.requester_country.toUpperCase()}`}
                        className="country-flag"
                      >
                        {countryCodeToFlag(request.requester_country)}
                      </span>
                    )}
                    <span>{request.requester_is_creator ? 'Mapper (auto)' : (request.requester_id ? 'osu! ID Cached' : 'Manual Entry')}</span>
                   </div>
                 </div>
               </RequesterCard>
             </div>

          </div>

          {/* RIGHT COLUMN: Request Settings */}
          <div className="request-modal-settings" style={{ display: 'flex', flexDirection: 'column', gap: '20px', borderLeft: '1px solid var(--border)', paddingLeft: '24px', minWidth: 0 }}>
            
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
                <option value="Considering">Considering</option>
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
                  ref={deadlineInputRef}
                  type="date"
                  className="input-text"
                  value={deadline}
                  autoFocus
                  onClick={(e) => e.currentTarget.showPicker?.()}
                  onChange={(e) => setDeadline(e.target.value)}
                  onBlur={() => setIsEditingDeadline(false)}
                />
              ) : (
                <div
                  onClick={() => { setIsEditingDeadline(true); window.setTimeout(() => deadlineInputRef.current?.showPicker?.(), 0); }}
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
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '6px' }}>
                <span>Date Added</span>
                {request.is_osu_link && (
                  <button type="button" onClick={handleRefreshAddedDate} disabled={isRefreshingAddedDate} style={{ color: 'var(--osu-pink)', fontSize: '10px', fontWeight: '600', textTransform: 'none', cursor: 'pointer' }}>
                    {isRefreshingAddedDate ? 'refreshing...' : 'use dates from osu!'}
                  </button>
                )}
              </label>
              {isEditingDate ? (
                <input
                  ref={addedDateInputRef}
                  type="date"
                  className="input-text"
                  value={addedDate}
                  autoFocus
                  onClick={(e) => e.currentTarget.showPicker?.()}
                  onChange={(e) => setAddedDate(e.target.value)}
                  onBlur={() => setIsEditingDate(false)}
                />
              ) : (
                <div
                  onClick={() => { setIsEditingDate(true); window.setTimeout(() => addedDateInputRef.current?.showPicker?.(), 0); }}
                  className="input-text"
                  style={{ cursor: 'pointer', color: addedDate ? 'var(--text-main)' : 'var(--text-muted)', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <span>{addedDate ? new Date(addedDate).toLocaleDateString() : '—'}</span>
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

                    {cat.systemKey === 'others' && cat.checked && (
                      <input
                        type="text"
                        className="input-text"
                        placeholder="Specify custom type..."
                        value={cat.otherText}
                        onChange={(e) => handleCategoryOtherTextChange(i, e.target.value)}
                        style={{ padding: '4px 8px', fontSize: '12px', backgroundColor: 'var(--bg-card)' }}
                      />
                    )}

                    {(cat.systemKey === 'guest_difficulties' || cat.viewType === 'guest_difficulties') && cat.checked && (
                      <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                        {uploadedGuestDifficulties.length > 0 && (
                          <div style={{ display: 'grid', gap: '5px', padding: '8px', backgroundColor: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: '6px' }}>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Uploaded selections — change these with Add Difficulties.</span>
                            {uploadedGuestDifficulties.map(row => (
                              <div key={row.beatmap_id} style={{ display: 'grid', gridTemplateColumns: '95px minmax(0, 1fr) 88px auto', gap: '5px', alignItems: 'center' }}>
                                <span className="badge badge-pending">{row.gamemode === 'fruits' ? 'catch' : row.gamemode}</span>
                                <input className="input-text" value={row.difficulty_name || ''} disabled style={{ padding: '5px 7px' }} />
                                <input className="input-text" type="number" value={row.target_sr ?? ''} disabled title="Uploaded difficulties use their current osu! star rating." style={{ padding: '5px 7px' }} />
                                <button type="button" className="btn-secondary" onClick={() => setGuestDifficulties(items => items.filter(item => Number(item.beatmap_id) !== Number(row.beatmap_id)))} style={{ padding: '5px' }} aria-label={`Remove ${row.difficulty_name || 'difficulty'}`}><Trash2 size={13} /></button>
                              </div>
                            ))}
                          </div>
                        )}
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Manual / unuploaded difficulties</span>
                        {manualGuestDifficulties.map((row, index) => {
                          const rowIndex = guestDifficulties.indexOf(row);
                          return (
                          <div key={row.id || index} style={{ display: 'grid', gridTemplateColumns: '95px minmax(0, 1fr) 88px auto', gap: '5px', alignItems: 'center' }}>
                            <select className="input-text" value={row.gamemode || 'osu'} onChange={event => setGuestDifficulties(items => items.map((item, itemIndex) => itemIndex === rowIndex ? { ...item, gamemode: event.target.value } : item))} style={{ padding: '5px' }}>
                              <option value="osu">osu!</option><option value="taiko">Taiko</option><option value="fruits">Catch</option><option value="mania">Mania</option>
                            </select>
                            <input className="input-text" placeholder="Difficulty name" value={row.difficulty_name || ''} onChange={event => setGuestDifficulties(items => items.map((item, itemIndex) => itemIndex === rowIndex ? { ...item, difficulty_name: event.target.value } : item))} style={{ padding: '5px 7px' }} />
                            <input className="input-text" type="number" step="0.01" min="0" placeholder="SR" value={row.target_sr ?? ''} onChange={event => setGuestDifficulties(items => items.map((item, itemIndex) => itemIndex === rowIndex ? { ...item, target_sr: event.target.value } : item))} style={{ padding: '5px 7px' }} />
                            <button type="button" className="btn-secondary" onClick={() => setGuestDifficulties(items => items.filter((_, itemIndex) => itemIndex !== rowIndex))} style={{ padding: '5px' }}><Trash2 size={13} /></button>
                          </div>
                          );
                        })}
                        <button type="button" className="btn-secondary" onClick={() => setGuestDifficulties(items => [...items, createManualGuestDifficulty()])} style={{ width: 'fit-content', padding: '5px 8px', fontSize: '11px' }}><Plus size={12} /> Add manual difficulty</button>
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
              <TagInput value={tags} onChange={setTags} suggestions={tagSuggestions} placeholder="Type or select existing tags" compact />
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

          </div>

        </div>

            {/* Modal action footer */}
            <div style={{
              borderTop: '1px solid var(--border)',
              padding: '16px 24px',
              backgroundColor: 'var(--bg-card)',
              flexShrink: 0
            }}>
              <button
                onClick={handleSave}
                className="btn-primary"
                disabled={isSaving}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {isSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>

          {/* RIGHT SIDEBAR: Activity History Log */}
          <aside className="request-modal-history" style={{
            width: '320px',
            flexShrink: 0,
            borderLeft: '1px solid var(--border)',
            padding: '24px 20px',
            backgroundColor: 'var(--bg-sidebar)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            minHeight: 0
          }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
              Activity History Log
            </h3>

            <div className="request-modal-history-list" style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: '10px', minHeight: 0, overflowY: 'auto', paddingRight: '8px' }}>
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
                        flexDirection: 'column',
                        gap: '5px',
                        fontSize: '12px',
                        borderBottom: '1px solid var(--border)',
                        paddingBottom: '10px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: '500' }}>
                          {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span style={{ color: 'var(--text-main)', fontWeight: '600', textTransform: 'uppercase', fontSize: '10px' }}>
                          [{log.action_type.replace('_', ' ')}]
                        </span>
                      </div>
                      <span style={{ color: 'var(--text-main)', lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                        {log.details}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </div>

      </div>

      {/* Local spin loader CSS style injected locally */}
      <style>{`
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
