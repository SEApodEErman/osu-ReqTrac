import React, { useEffect, useState, useRef } from 'react';
import { Plus, Link, AlertCircle, X, Loader2, UserCheck } from 'lucide-react';
import TagInput from './TagInput';

const OSU_BEATMAP_LINK_PATTERN = /osu\.ppy\.sh\/(?:beatmapsets|beatmaps|b)\/\d+/i;

export default function QuickAdd({ 
  onAddRequest, 
  duplicateError, 
  onResolveDuplicate, 
  onCancelDuplicate,
  isOpen,
  onToggle,
  defaultCategory = 'All',
  onNotify,
  categoryDefinitions = [],
  tagSuggestions = [],
}) {
  const [inputVal, setInputVal] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingInfo, setIsFetchingInfo] = useState(false);
  const formRef = useRef(null);
  
  // Manual form states
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [creator, setCreator] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [requester, setRequester] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('Low');
  const [deadline, setDeadline] = useState('');
  const [tags, setTags] = useState([]);
  const [guestDifficulties, setGuestDifficulties] = useState([{ gamemode: 'osu', difficulty_name: '', target_sr: '' }]);
  
  // Categories Checklist
  const getDefaultCategories = () => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('lastRequestCategories') || '{}'); } catch { saved = {}; }
    const defaults = Object.fromEntries(categoryDefinitions.map(category => [category.id, Boolean(saved[category.id] ?? saved[category.name] ?? category.system_key === 'hitsounds')]));
    const activeDefinition = categoryDefinitions.find(category => category.name === defaultCategory || category.id === Number(defaultCategory));
    if (activeDefinition) defaults[activeDefinition.id] = true;
    return defaults;
  };
  const [categories, setCategories] = useState(getDefaultCategories);
  const [otherText, setOtherText] = useState('');
  const isOsuBeatmapLink = OSU_BEATMAP_LINK_PATTERN.test(inputVal);

  useEffect(() => {
    setCategories(current => {
      const next = getDefaultCategories();
      categoryDefinitions.forEach(category => {
        if (current[category.id] !== undefined) next[category.id] = current[category.id];
      });
      return next;
    });
  }, [categoryDefinitions, defaultCategory]);

  // Fetch beatmap info from osu! API
  const fetchBeatmapInfo = async (link) => {
    if (!OSU_BEATMAP_LINK_PATTERN.test(link)) return;

    setIsFetchingInfo(true);
    try {
      const res = await fetch(`/api/requests/beatmap-info?link=${encodeURIComponent(link)}`);
      if (res.ok) {
        const data = await res.json();
        setArtist(data.artist || '');
        setTitle(data.title || '');
        setCreator(data.creator || '');
        setRequester(data.creatorUsername || '');
      }
    } catch (e) {
      console.error('Failed to fetch beatmap info:', e);
    } finally {
      setIsFetchingInfo(false);
    }
  };

  const handleInputChange = (event) => {
    const value = event.target.value;
    setInputVal(value);

    if (OSU_BEATMAP_LINK_PATTERN.test(value)) {
      void fetchBeatmapInfo(value);
    }
  };

  const toggleCategory = (cat) => {
    setCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const buildCategoryPayload = () => categoryDefinitions
    .filter(category => categories[category.id])
    .map(category => ({
      category_id: category.id,
      name: category.name,
      other_text: category.system_key === 'others' ? otherText : null,
      status: 'Pending'
    }));

  const resetForm = () => {
    setInputVal('');
    setArtist('');
    setTitle('');
    setCreator('');
    setDifficulty('');
    setRequester('');
    setNotes('');
    setPriority('Low');
    setDeadline('');
    setTags([]);
    setGuestDifficulties([{ gamemode: 'osu', difficulty_name: '', target_sr: '' }]);
    localStorage.setItem('lastRequestCategories', JSON.stringify(categories));
    setCategories(getDefaultCategories());
    setOtherText('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    // Build categories payload
    const catsPayload = buildCategoryPayload();

    if (catsPayload.length === 0) {
      onNotify?.('Please select at least one request category.', 'warning');
      return;
    }

    const payload = {
      categories: catsPayload,
      priority,
      deadline: deadline || null,
      notes: notes || null,
      tags,
      guest_difficulties: catsPayload.some(category => categoryDefinitions.find(definition => definition.id === category.category_id)?.system_key === 'guest_difficulties')
        ? guestDifficulties
        : [],
    };

    if (isOsuBeatmapLink) {
      payload.link = inputVal.trim();
      payload.requester_username = requester.trim() || null;
    } else {
      // Manual entry
      payload.link = inputVal.trim() || null;
      payload.artist = artist.trim();
      payload.title = title.trim();
      payload.creator = creator.trim();
      payload.difficulty = difficulty.trim() || null;
      payload.requester_username = requester.trim() || creator.trim() || 'Anonymous';

      if (!payload.artist || !payload.title || !payload.creator) {
        onNotify?.('Please fill out Artist, Title, and Creator for manual entries.', 'warning');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const result = await onAddRequest(payload, resetForm);
      if (result?.ok) onToggle(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    resetForm();
    onToggle(false);
  };

  return (
    <div className="card" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      gap: '16px', 
      borderLeft: '4px solid var(--osu-pink)',
      maxHeight: isOpen ? '2400px' : '0',
      overflow: 'hidden',
      opacity: isOpen ? 1 : 0,
      transition: 'max-height 0.3s ease, opacity 0.2s ease, padding 0.2s ease, margin 0.2s ease',
      padding: isOpen ? '16px' : '0',
      marginBottom: isOpen ? '16px' : '0',
    }}>
      {isOpen && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Plus size={18} style={{ color: 'var(--osu-pink)' }} />
              Add Request
            </h3>
            <button
              type="button"
              onClick={handleCancel}
              style={{ 
                fontSize: '12px', 
                color: 'var(--text-muted)', 
                cursor: 'pointer', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '6px',
                background: 'transparent',
                border: 'none'
              }}
            >
              <X size={14} />
              <span>Cancel</span>
            </button>
          </div>

          {/* Duplicate warning prompt */}
          {duplicateError && (
            <div data-duplicate-warning style={{
              backgroundColor: 'rgba(243, 156, 18, 0.15)',
              border: '1px solid var(--priority-medium)',
              borderRadius: '8px',
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              color: 'var(--text-main)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600' }}>
                <AlertCircle size={18} style={{ color: 'var(--priority-medium)' }} />
                <span>Duplicate Beatmapset Detected</span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                This beatmapset is already registered in your tracking workspace. Would you like to merge these new categories into the existing request instead?
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={async () => {
                    const result = await onResolveDuplicate(duplicateError.requestId, buildCategoryPayload(), resetForm);
                    if (result?.ok) onToggle(false);
                  }}
                  className="btn-primary"
                  style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: 'var(--priority-medium)' }}
                >
                  Add to Existing Request
                </button>
                <button
                  onClick={async () => {
                    const catsPayload = buildCategoryPayload();
                    const payload = {
                      categories: catsPayload,
                      priority,
                      deadline: deadline || null,
                      notes: notes || null,
                      tags,
                      guest_difficulties: guestDifficulties,
                      force: true
                    };
                    if (isOsuBeatmapLink) {
                      payload.link = inputVal.trim();
                      payload.requester_username = requester.trim() || null;
                    } else {
                      payload.link = inputVal.trim() || null;
                      payload.artist = artist.trim();
                      payload.title = title.trim();
                      payload.creator = creator.trim();
                      payload.difficulty = difficulty.trim() || null;
                      payload.requester_username = requester.trim() || creator.trim() || 'Anonymous';
                    }
                    const result = await onAddRequest(payload, resetForm);
                    if (result?.ok) onToggle(false);
                  }}
                  className="btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                >
                  Create New Anyway
                </button>
                <button
                  onClick={onCancelDuplicate}
                  className="btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '12px', border: 'none', background: 'transparent' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} ref={formRef} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            
            {/* Main link or text input */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ position: 'relative', flexGrow: 1 }}>
                <span style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }}>
                  <Link size={16} />
                </span>
                <input
                  type="text"
                  className="input-text"
                  placeholder="Paste osu! beatmap link or any other relevant links."
                  value={inputVal}
                  onChange={handleInputChange}
                  style={{ paddingLeft: '36px' }}
                  autoFocus
                />
              </div>
            </div>

            {/* Fetching indicator */}
            {isFetchingInfo && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                fontSize: '12px', 
                color: 'var(--text-muted)',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-sidebar)',
                borderRadius: '6px',
                border: '1px solid var(--border)'
              }}>
                <Loader2 size={16} className="spin" style={{ color: 'var(--osu-pink)' }} />
                <span>Fetching beatmap info...</span>
                <UserCheck size={14} style={{ color: 'var(--req-completed)' }} />
              </div>
            )}

            {/* Categories Checklist (Always show to specify what requests you want) */}
            <div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>
                Request Categories
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                {categoryDefinitions.map((category) => (
                  <label key={category.id} className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={Boolean(categories[category.id])}
                      onChange={() => toggleCategory(category.id)}
                    />
                    <span className="checkmark"></span>
                    <span style={{ fontSize: '13px' }}>{category.name}</span>
                  </label>
                ))}
              </div>

              {categoryDefinitions.some(category => category.system_key === 'others' && categories[category.id]) && (
                <input
                  type="text"
                  className="input-text"
                  placeholder="Specify custom category (e.g. Video editing)..."
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  style={{ marginTop: '8px' }}
                />
              )}

              {categoryDefinitions.some(category => category.system_key === 'guest_difficulties' && categories[category.id]) && (
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                  {guestDifficulties.map((guestDifficulty, index) => (
                    <div key={index} style={{ display: 'grid', gridTemplateColumns: '110px minmax(140px, 1fr) 110px auto', gap: '6px', alignItems: 'center' }}>
                      <select className="input-text" value={guestDifficulty.gamemode} onChange={event => setGuestDifficulties(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, gamemode: event.target.value } : row))}>
                        <option value="osu">osu!</option><option value="taiko">Taiko</option><option value="fruits">Catch</option><option value="mania">Mania</option>
                      </select>
                      <input className="input-text" placeholder="Difficulty name" value={guestDifficulty.difficulty_name} onChange={event => setGuestDifficulties(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, difficulty_name: event.target.value } : row))} />
                      <input className="input-text" type="number" min="0" step="0.01" placeholder="Target SR" value={guestDifficulty.target_sr} onChange={event => setGuestDifficulties(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, target_sr: event.target.value } : row))} />
                      <button type="button" className="btn-secondary" disabled={guestDifficulties.length === 1} onClick={() => setGuestDifficulties(rows => rows.filter((_, rowIndex) => rowIndex !== index))}><X size={14} /></button>
                    </div>
                  ))}
                  <button type="button" className="btn-secondary" style={{ width: 'fit-content' }} onClick={() => setGuestDifficulties(rows => [...rows, { gamemode: 'osu', difficulty_name: '', target_sr: '' }])}>
                    <Plus size={14} /> Add guest difficulty
                  </button>
                </div>
              )}
            </div>

            {/* Dynamic manual fields expanded */}
            <div className="fade-in" style={{
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
                gap: '12px',
                backgroundColor: 'var(--bg-sidebar)',
                padding: '16px',
                borderRadius: '8px',
                border: '1px solid var(--border)'
              }}>
                {/* Artist */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Artist *</label>
                  <input type="text" className="input-text" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="e.g. Camellia" disabled={isOsuBeatmapLink} style={{ opacity: isOsuBeatmapLink ? 0.6 : 1 }} />
                </div>
                
                {/* Title */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Song Title *</label>
                  <input type="text" className="input-text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Exit This Earth's Atomosphere" disabled={isOsuBeatmapLink} style={{ opacity: isOsuBeatmapLink ? 0.6 : 1 }} />
                </div>

                {/* Creator */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Creator / Mapper *</label>
                  <input type="text" className="input-text" value={creator} onChange={(e) => setCreator(e.target.value)} placeholder="e.g. ProfessionalMapper" disabled={isOsuBeatmapLink} style={{ opacity: isOsuBeatmapLink ? 0.6 : 1 }} />
                </div>

                {/* Difficulty */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Difficulty Name (Optional)</label>
                  <input type="text" className="input-text" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} placeholder="e.g. Extra, Collab Insane" />
                </div>

                {/* Requester Username */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Requester Username</label>
                  <input type="text" className="input-text" value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="e.g. Peppy" disabled={isOsuBeatmapLink} style={{ opacity: isOsuBeatmapLink ? 0.6 : 1 }} />
                </div>

                {/* Priority */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Priority</label>
                  <select className="input-text" value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>

                {/* Deadline */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Deadline</label>
                  <input type="date" className="input-text" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                </div>

                {/* Tags */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Tags</label>
                  <TagInput value={tags} onChange={setTags} suggestions={tagSuggestions} placeholder="Type or select existing tags" />
                </div>

                {/* Notes (spanning full row) */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Notes</label>
                  <textarea 
                    className="input-text" 
                    value={notes} 
                    onChange={(e) => setNotes(e.target.value)} 
                    placeholder="Details of hitsounds style, guest diff requirements, storyboard theme, etc..."
                    style={{ minHeight: '60px', resize: 'vertical' }}
                  />
                </div>

                {/* Form actions */}
                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                  <button type="button" onClick={resetForm} className="btn-secondary" disabled={isSubmitting}>
                    Reset
                  </button>
                  <button type="submit" className="btn-primary" disabled={isSubmitting}>
                    <Plus size={16} />
                    <span>{isSubmitting ? 'Creating...' : 'Create Request'}</span>
                  </button>
                </div>

              </div>

          </form>
        </>
      )}
    </div>
  );
}
