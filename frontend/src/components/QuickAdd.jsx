import React, { useState, useRef } from 'react';
import { Plus, Link, AlertCircle, X, Loader2, UserCheck } from 'lucide-react';

export default function QuickAdd({ 
  onAddRequest, 
  duplicateError, 
  onResolveDuplicate, 
  onCancelDuplicate,
  isOpen,
  onToggle
}) {
  const [inputVal, setInputVal] = useState('');
  const [isManual, setIsManual] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingInfo, setIsFetchingInfo] = useState(false);
  const formRef = useRef(null);
  
  // Manual form states
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [creator, setCreator] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [requester, setRequester] = useState('');
  const [profileLink, setProfileLink] = useState('');
  const [discordLink, setDiscordLink] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [deadline, setDeadline] = useState('');
  const [tags, setTags] = useState('');
  
  // Categories Checklist
  const [categories, setCategories] = useState({
    Hitsounds: true,
    'Guest Difficulties': false,
    Storyboards: false,
    Others: false
  });
  const [otherText, setOtherText] = useState('');

  // Fetch beatmap info from osu! API
  const fetchBeatmapInfo = async (link) => {
    const isOsu = /osu\.ppy\.sh\/(?:beatmapsets|beatmaps|b)\/\d+/i.test(link);
    if (!isOsu) return;

    setIsFetchingInfo(true);
    try {
      const res = await fetch(`/api/requests/beatmap-info?link=${encodeURIComponent(link)}`);
      if (res.ok) {
        const data = await res.json();
        // Auto-populate requester fields with beatmap creator info
        if (data.creatorUsername) {
          setRequester(data.creatorUsername);
        }
        if (data.creatorProfileUrl) {
          setProfileLink(data.creatorProfileUrl);
        }
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

    const isOsu = /osu\.ppy\.sh\/(?:beatmapsets|beatmaps|b)\/\d+/i.test(value);
    if (isOsu) {
      setIsManual(false);
      void fetchBeatmapInfo(value);
    } else if (/^https?:\/\//i.test(value)) {
      setIsManual(true);
    }
  };

  const toggleCategory = (cat) => {
    setCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const resetForm = () => {
    setInputVal('');
    setArtist('');
    setTitle('');
    setCreator('');
    setDifficulty('');
    setRequester('');
    setProfileLink('');
    setDiscordLink('');
    setNotes('');
    setPriority('Medium');
    setDeadline('');
    setTags('');
    setCategories({
      Hitsounds: true,
      'Guest Difficulties': false,
      Storyboards: false,
      Others: false
    });
    setOtherText('');
    setIsManual(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputVal.trim() && !isManual) return;
    if (isSubmitting) return;

    // Build categories payload
    const catsPayload = Object.entries(categories)
      .filter(([_, checked]) => checked)
      .map(([name, _]) => ({
        name,
        other_text: name === 'Others' ? otherText : null,
        status: 'Pending'
      }));

    if (catsPayload.length === 0) {
      alert('Please select at least one request category.');
      return;
    }

    const payload = {
      categories: catsPayload,
      priority,
      deadline: deadline || null,
      notes: notes || null,
      discord_link: discordLink || null,
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : []
    };

    const isOsu = /osu\.ppy\.sh\/(?:beatmapsets|beatmaps|b)\/\d+/i.test(inputVal);
    if (isOsu) {
      payload.link = inputVal.trim();
      payload.requester_username = requester || null;
      payload.osu_profile_link = profileLink || null;
    } else {
      // Manual entry
      payload.link = inputVal.trim() || null;
      payload.artist = artist.trim();
      payload.title = title.trim();
      payload.creator = creator.trim();
      payload.difficulty = difficulty.trim() || null;
      payload.requester_username = requester.trim() || 'Anonymous';
      payload.osu_profile_link = profileLink.trim() || null;

      if (!payload.artist || !payload.title || !payload.creator) {
        alert('Please fill out Artist, Title, and Creator for manual entries.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await onAddRequest(payload, resetForm);
      // Close form on successful submission
      onToggle(false);
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
      maxHeight: isOpen ? '1000px' : '0',
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
              Quick Add Request
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
            <div style={{
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
                  onClick={() => {
                    const catsPayload = Object.entries(categories)
                      .filter(([_, checked]) => checked)
                      .map(([name, _]) => ({
                        name,
                        other_text: name === 'Others' ? otherText : null,
                        status: 'Pending'
                      }));
                    onResolveDuplicate(duplicateError.requestId, catsPayload, resetForm);
                  }}
                  className="btn-primary"
                  style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: 'var(--priority-medium)' }}
                >
                  Add to Existing Request
                </button>
                <button
                  onClick={() => {
                    const catsPayload = Object.entries(categories)
                      .filter(([_, checked]) => checked)
                      .map(([name, _]) => ({
                        name,
                        other_text: name === 'Others' ? otherText : null,
                        status: 'Pending'
                      }));
                    const isOsu = /osu\.ppy\.sh\/(?:beatmapsets|beatmaps|b)\/\d+/i.test(inputVal);
                    const payload = {
                      categories: catsPayload,
                      priority,
                      deadline: deadline || null,
                      notes: notes || null,
                      discord_link: discordLink || null,
                      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
                      force: true
                    };
                    if (isOsu) {
                      payload.link = inputVal.trim();
                      payload.requester_username = requester || null;
                      payload.osu_profile_link = profileLink || null;
                    }
                    onAddRequest(payload, resetForm);
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
                  placeholder="Paste osu! beatmap link (e.g., https://osu.ppy.sh/beatmapsets/123456)..."
                  value={inputVal}
                  onChange={handleInputChange}
                  style={{ paddingLeft: '36px' }}
                  autoFocus
                />
              </div>
              {!isManual && (
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  <Plus size={16} />
                  <span>{isSubmitting ? 'Adding...' : 'Add'}</span>
                </button>
              )}
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

            {/* Auto-populated requester info for osu! links */}
            {!isManual && inputVal && /osu\.ppy\.sh\/(?:beatmapsets|beatmaps|b)\/\d+/i.test(inputVal) && requester && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                fontSize: '12px', 
                color: 'var(--text-muted)',
                padding: '8px 12px',
                backgroundColor: 'rgba(255, 102, 170, 0.1)',
                borderRadius: '6px',
                border: '1px solid rgba(255, 102, 170, 0.2)'
              }}>
                <UserCheck size={14} style={{ color: 'var(--req-completed)' }} />
                <span>Requester auto-populated from beatmap creator: <strong>{requester}</strong></span>
                <button
                  type="button"
                  onClick={() => { setRequester(''); setProfileLink(''); }}
                  style={{ 
                    marginLeft: 'auto',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    background: 'none',
                    border: 'none',
                    fontSize: '10px',
                    textDecoration: 'underline'
                  }}
                >
                  Clear
                </button>
              </div>
            )}

            {/* Categories Checklist (Always show to specify what requests you want) */}
            <div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>
                Request Categories
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                {Object.keys(categories).map((cat) => (
                  <label key={cat} className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={categories[cat]}
                      onChange={() => toggleCategory(cat)}
                    />
                    <span className="checkmark"></span>
                    <span style={{ fontSize: '13px' }}>{cat}</span>
                  </label>
                ))}
              </div>

              {categories.Others && (
                <input
                  type="text"
                  className="input-text"
                  placeholder="Specify custom category (e.g. Video editing)..."
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  style={{ marginTop: '8px' }}
                />
              )}
            </div>

            {/* Dynamic manual fields expanded */}
            {isManual && (
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
                  <input type="text" className="input-text" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="e.g. Camellia" />
                </div>
                
                {/* Title */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Song Title *</label>
                  <input type="text" className="input-text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Exit This Earth's Atomosphere" />
                </div>

                {/* Creator */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Creator / Mapper *</label>
                  <input type="text" className="input-text" value={creator} onChange={(e) => setCreator(e.target.value)} placeholder="e.g. ProfessionalMapper" />
                </div>

                {/* Difficulty */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Difficulty Name (Optional)</label>
                  <input type="text" className="input-text" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} placeholder="e.g. Extra, Collab Insane" />
                </div>

                {/* Requester Username */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Requester Username</label>
                  <input type="text" className="input-text" value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="e.g. Peppy" />
                </div>

                {/* Requester Profile Link */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Requester osu! Link</label>
                  <input type="text" className="input-text" value={profileLink} onChange={(e) => setProfileLink(e.target.value)} placeholder="https://osu.ppy.sh/users/2" />
                </div>

                {/* Discord discussion link */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Discord / Contact Link</label>
                  <input type="text" className="input-text" value={discordLink} onChange={(e) => setDiscordLink(e.target.value)} placeholder="https://discord.gg/invite" />
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
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Tags (comma-separated)</label>
                  <input type="text" className="input-text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. tournament, metal, fast" />
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
            )}

          </form>
        </>
      )}
    </div>
  );
}
