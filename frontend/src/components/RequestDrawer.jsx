import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Replace,
  Trash2,
  X,
} from 'lucide-react';
import Dialog from './ui/Dialog';
import TagInput from './TagInput';
import Avatar from './ui/Avatar';
import { coverBackground } from './ui/CoverImage';
import { StarBadge, StatusPill } from './ui/Badges';
import { usePopover } from './ui/usePopover';
import { api } from '../api/client';
import { countryCodeToFlag } from '../utils/countryFlag';
import { describeDeadline, formatDateTime, toDateInputValue } from '../utils/dates';
import { beatmapsetDiscussionUrl, beatmapsetUrl, openExternal, userProfileUrl } from '../utils/osuLinks';
import {
  GAMEMODES,
  PRIORITIES,
  REQUEST_STATUSES,
  REQUEST_STATUS_HINTS,
  beatmapStatusClass,
  beatmapStatusLabel,
  gamemodeLabel,
  isMetadataPending,
  priorityClass,
  requestDisplayTitle,
} from '../utils/requestConstants';
import {
  addUploadedGuestDifficulty,
  createManualGuestDifficulty,
  isDifficultySelected,
  isUploadedGuestDifficulty,
  normalizeGamemode,
} from '../utils/guestDifficulties';

const HISTORY_LABELS = {
  status_change: 'Status changed',
  priority_change: 'Priority changed',
  deadline_change: 'Deadline changed',
  added_date_change: 'Added date changed',
  added_date_refreshed_from_osu: 'Added date set from osu!',
  notes_change: 'Notes edited',
  created: 'Request added',
};

function isGuestCategory(category) {
  return category.systemKey === 'guest_difficulties' || category.viewType === 'guest_difficulties';
}

function buildCategories(request, definitions) {
  const all = [...definitions];
  for (const requestCategory of request.categories || []) {
    if (!all.some(definition => definition.id === requestCategory.category_id)) {
      all.push({
        id: requestCategory.category_id,
        name: requestCategory.category_name,
        system_key: requestCategory.system_key,
        view_type: requestCategory.view_type || 'tagged',
        archived: requestCategory.is_active === 0,
      });
    }
  }
  return all.map(definition => {
    const match = (request.categories || []).find(category => category.category_id === definition.id);
    return {
      id: definition.id,
      name: definition.name,
      systemKey: definition.system_key,
      viewType: definition.view_type,
      archived: Boolean(definition.archived),
      checked: Boolean(match),
      status: match?.status || 'Pending',
      otherText: match?.other_text || '',
    };
  });
}

function formFromRequest(request, definitions) {
  return {
    request_status: request.request_status,
    priority: request.priority || 'Low',
    deadline: toDateInputValue(request.deadline),
    added_date: toDateInputValue(request.added_date),
    categories: buildCategories(request, definitions),
    guest_difficulties: request.guest_difficulties?.length
      ? request.guest_difficulties.map(row => ({ ...row, target_sr: row.target_sr ?? '' }))
      : [],
    tags: request.tags || [],
    notes: request.notes || '',
    discord_link: request.discord_link || '',
    osu_profile_link: request.osu_profile_link || '',
    artist: request.artist || '',
    title: request.title || '',
    creator: request.creator || '',
    difficulty_name: request.difficulty_name || '',
    requester_username: request.requester_username || '',
  };
}

function isConnectedUsersDifficulty(difficulty, connectedAccount) {
  if (!connectedAccount) return false;
  const owners = Array.isArray(difficulty.creator_names) && difficulty.creator_names.length ? difficulty.creator_names : [difficulty.creator_name].filter(Boolean);
  return (Array.isArray(difficulty.creator_ids) && difficulty.creator_ids.map(Number).includes(Number(connectedAccount.id)))
    || owners.some(owner => owner?.toLowerCase() === connectedAccount.username?.toLowerCase());
}

function DifficultyCard({ difficulty, connectedAccount, selectable, selected, onToggle }) {
  const mode = normalizeGamemode(difficulty.mode);
  const owners = Array.isArray(difficulty.creator_names) && difficulty.creator_names.length ? difficulty.creator_names : [difficulty.creator_name].filter(Boolean);
  const isYours = isConnectedUsersDifficulty(difficulty, connectedAccount);
  const stats = mode === 'mania'
    ? [`${difficulty.cs ?? '?'}K`, `OD ${difficulty.od ?? '—'}`, `HP ${difficulty.hp ?? '—'}`]
    : mode === 'taiko'
      ? [`OD ${difficulty.od ?? '—'}`, `HP ${difficulty.hp ?? '—'}`]
      : [`CS ${difficulty.cs ?? '—'}`, `AR ${difficulty.ar ?? '—'}`, `OD ${difficulty.od ?? '—'}`, `HP ${difficulty.hp ?? '—'}`];
  const length = difficulty.drain ? `${Math.floor(difficulty.drain / 60)}:${String(Math.floor(difficulty.drain % 60)).padStart(2, '0')}` : null;
  const Element = selectable ? 'button' : 'div';

  return (
    <Element
      type={selectable ? 'button' : undefined}
      className="diff-card"
      aria-pressed={selectable ? selected : undefined}
      onClick={selectable ? onToggle : undefined}
      title={selectable ? (selected ? 'Marked as yours — click to unmark' : 'Click to mark as one of your guest difficulties') : undefined}
    >
      <div className="diff-card-name">
        <StarBadge stars={difficulty.stars} />
        <span className="truncate">{difficulty.name}</span>
        {selectable && selected && <Check size={13} style={{ marginLeft: 'auto', color: 'var(--accent)', flex: '0 0 auto' }} />}
      </div>
      <div className="diff-card-stats">
        {gamemodeLabel(mode)} · {stats.join(' · ')}
        {(difficulty.bpm || length) && <><br />{[difficulty.bpm && `${difficulty.bpm} BPM`, length && `${length} drain`].filter(Boolean).join(' · ')}</>}
      </div>
      {owners.length > 0 && <div className={`diff-card-owner${isYours ? ' is-you' : ''}`}>{isYours ? 'Yours' : `by ${owners.join(', ')}`}</div>}
    </Element>
  );
}

function MoreMenu({ onChangeMapset, onDelete, canChangeMapset }) {
  const popover = usePopover();
  return (
    <span ref={popover.containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className="btn btn-icon btn-sm" onClick={popover.toggle} aria-label="More actions" title="More actions"><MoreHorizontal size={16} /></button>
      {popover.isOpen && (
        <div className="popover popover-end popover-below menu" style={{ minWidth: 220 }}>
          {canChangeMapset && <button type="button" className="menu-item" onClick={() => { popover.close(); onChangeMapset(); }}><Replace size={14} />Change beatmapset…</button>}
          <button type="button" className="menu-item" style={{ color: 'var(--danger)' }} onClick={() => { popover.close(); onDelete(); }}><Trash2 size={14} />Delete request</button>
        </div>
      )}
    </span>
  );
}

export default function RequestDrawer({
  request,
  categories: categoryDefinitions,
  tagSuggestions,
  connectedAccount,
  actions,
  onClose,
  onRequestConfirmation,
  onNotify,
}) {
  const initialForm = useMemo(() => formFromRequest(request, categoryDefinitions), [request, categoryDefinitions]);
  const [form, setForm] = useState(initialForm);
  const [baseline, setBaseline] = useState(initialForm);
  const [tab, setTab] = useState('details');
  const [difficulties, setDifficulties] = useState(null);
  const [history, setHistory] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [mapsetLink, setMapsetLink] = useState('');
  const [showMapsetChange, setShowMapsetChange] = useState(false);
  const [linkToOsu, setLinkToOsu] = useState('');

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [baseline, form]);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  // Pick up outside changes (inline edits, syncs) while there are no local edits.
  useEffect(() => {
    if (!isDirtyRef.current) {
      setForm(initialForm);
      setBaseline(initialForm);
    }
  }, [initialForm]);

  const loadDifficulties = useCallback(async () => {
    if (!request.is_osu_link || !request.beatmapset_id) {
      setDifficulties([]);
      return;
    }
    try {
      const beatmap = await api.get(`/api/beatmaps/${request.beatmapset_id}?cacheOnly=1`);
      setDifficulties(beatmap?.difficulties || []);
    } catch {
      setDifficulties([]);
    }
  }, [request.beatmapset_id, request.is_osu_link]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api.get(`/api/requests/${request.id}/history`));
    } catch {
      setHistory([]);
    }
  }, [request.id]);

  useEffect(() => { void loadDifficulties(); }, [loadDifficulties, request.metadata_sync_status]);
  useEffect(() => { if (tab === 'history') void loadHistory(); }, [loadHistory, tab, request.last_updated]);

  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const hasGuestCategory = form.categories.some(category => category.checked && isGuestCategory(category));
  const uploadedSelections = form.guest_difficulties.filter(isUploadedGuestDifficulty);
  const manualRows = form.guest_difficulties.map((row, index) => ({ row, index })).filter(({ row }) => !isUploadedGuestDifficulty(row));

  const toggleUploaded = (difficulty) => set('guest_difficulties', isDifficultySelected(form.guest_difficulties, difficulty.id)
    ? form.guest_difficulties.filter(row => Number(row.beatmap_id) !== Number(difficulty.id))
    : addUploadedGuestDifficulty(form.guest_difficulties, difficulty));

  const updateGuestRow = (index, patch) => set('guest_difficulties', form.guest_difficulties.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));

  const buildPatch = () => {
    const changed = key => JSON.stringify(form[key]) !== JSON.stringify(baseline[key]);
    const patch = {};
    for (const key of ['request_status', 'priority', 'notes', 'discord_link', 'osu_profile_link']) {
      if (changed(key)) patch[key] = form[key] || (key === 'request_status' || key === 'priority' ? form[key] : null);
    }
    if (changed('deadline')) patch.deadline = form.deadline || null;
    if (changed('added_date')) patch.added_date = form.added_date || null;
    if (changed('tags')) patch.tags = form.tags;
    if (changed('categories') || changed('guest_difficulties')) {
      patch.categories = form.categories.filter(category => category.checked).map(category => ({
        category_id: category.id,
        category_name: category.name,
        other_text: category.systemKey === 'others' ? category.otherText : null,
        status: category.status || 'Pending',
      }));
      patch.guest_difficulties = hasGuestCategory
        ? form.guest_difficulties.filter(row => isUploadedGuestDifficulty(row) || String(row.difficulty_name || '').trim() || String(row.target_sr ?? '').trim())
        : [];
    }
    if (!request.is_osu_link && ['artist', 'title', 'creator', 'difficulty_name', 'requester_username'].some(changed)) {
      // The server updates these together, so always send the full set.
      Object.assign(patch, {
        non_osu_artist: form.artist.trim(),
        non_osu_title: form.title.trim(),
        non_osu_creator: form.creator.trim(),
        non_osu_difficulty: form.difficulty_name.trim() || null,
        requester_username: form.requester_username.trim() || form.creator.trim() || 'Anonymous',
      });
    }
    return patch;
  };

  const save = async () => {
    if (!isDirty || isSaving) return true;
    if (!form.categories.some(category => category.checked)) {
      onNotify('Keep at least one category on the request.', 'warning');
      return false;
    }
    setIsSaving(true);
    try {
      const ok = await actions.updateRequest(request.id, buildPatch());
      if (ok) {
        setBaseline(form);
        if (tab === 'history') void loadHistory();
      }
      return ok;
    } finally {
      setIsSaving(false);
    }
  };

  const requestClose = async () => {
    if (isDirty) {
      const discard = await onRequestConfirmation({
        title: 'Discard unsaved changes?',
        message: 'You changed this request but haven’t saved. Closing now throws those changes away.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
      });
      if (!discard) return;
    }
    onClose();
  };

  const runAction = async (name, task) => {
    setBusyAction(name);
    window.dispatchEvent(new Event('reqtrac:api-activity'));
    try {
      return await task();
    } finally {
      setBusyAction(null);
    }
  };

  const refreshFromOsu = () => runAction('refresh', async () => {
    const refreshed = await actions.refreshBeatmap(request.beatmapset_id, request.id);
    if (refreshed) setDifficulties(refreshed);
  });

  const useOsuDate = () => runAction('date', async () => {
    const date = await actions.refreshRequestDate(request.id);
    if (date) {
      const value = toDateInputValue(date);
      setForm(current => ({ ...current, added_date: value }));
      setBaseline(current => ({ ...current, added_date: value }));
    }
  });

  const changeMapset = () => runAction('mapset', async () => {
    const result = await actions.changeMapset(request.id, mapsetLink.trim());
    if (result.ok) {
      setMapsetLink('');
      setShowMapsetChange(false);
      void loadDifficulties();
    }
  });

  const linkManual = () => runAction('link', async () => {
    const result = await actions.linkManualRequest(request.id, linkToOsu.trim());
    if (result.ok) setLinkToOsu('');
  });

  const deleteRequest = () => {
    actions.deleteRequests([request.id], `“${requestDisplayTitle(request)}”`);
    onClose();
  };

  const copyLink = async () => {
    const url = request.beatmapset_id ? beatmapsetUrl(request.beatmapset_id) : request.input_link;
    try {
      await navigator.clipboard.writeText(url);
      onNotify('Link copied.', 'success', { duration: 2000 });
    } catch {
      onNotify('Couldn’t copy the link.', 'error');
    }
  };

  const pending = isMetadataPending(request);
  const deadline = describeDeadline(form.deadline, form.request_status);
  const requesterProfile = request.osu_profile_link || (request.requester_id ? userProfileUrl(request.requester_id) : null);
  const yourDifficulties = (difficulties || []).filter(difficulty => isDifficultySelected(form.guest_difficulties, difficulty.id));

  const header = (
    <div className="drawer-hero">
      <div className="drawer-hero-cover" style={coverBackground(request.local_cover_path)} />
      <div className="drawer-hero-actions">
        {request.beatmapset_id && (
          <>
            <button type="button" className="btn btn-icon btn-sm" onClick={() => openExternal(beatmapsetUrl(request.beatmapset_id))} title="Open on osu!" aria-label="Open on osu!"><ExternalLink size={15} /></button>
            <button type="button" className="btn btn-icon btn-sm" onClick={() => openExternal(beatmapsetDiscussionUrl(request.beatmapset_id))} title="Open modding discussion" aria-label="Open modding discussion"><MessageSquare size={15} /></button>
          </>
        )}
        {(request.beatmapset_id || request.input_link) && <button type="button" className="btn btn-icon btn-sm" onClick={copyLink} title="Copy link" aria-label="Copy link"><Copy size={15} /></button>}
        {request.is_osu_link && request.beatmapset_id && (
          <button type="button" className="btn btn-icon btn-sm" onClick={refreshFromOsu} disabled={Boolean(busyAction) || pending} title="Refresh from osu!" aria-label="Refresh from osu!">
            <RefreshCw size={15} className={busyAction === 'refresh' ? 'spin' : undefined} />
          </button>
        )}
        <MoreMenu canChangeMapset={Boolean(request.is_osu_link)} onChangeMapset={() => { setTab('beatmap'); setShowMapsetChange(true); }} onDelete={deleteRequest} />
        <button type="button" className="btn btn-icon btn-sm" onClick={requestClose} title="Close (Esc)" aria-label="Close"><X size={16} /></button>
      </div>
      <div className="drawer-hero-content">
        <div className="view-actions">
          <StatusPill status={request.request_status} />
          <span className={`pill ${beatmapStatusClass(request)}`}>{pending && <Loader2 size={10} className="spin" />}{beatmapStatusLabel(request)}</span>
          {deadline && <span className={`pill deadline-${deadline.tone}`} style={{ '--pill-color': 'currentColor' }}>{deadline.text}</span>}
        </div>
        <h2 className="drawer-hero-title">{requestDisplayTitle(request)}</h2>
        <div className="drawer-hero-meta">
          {request.artist ? `${request.artist} · mapped by ${request.creator || 'unknown'}` : pending ? 'Details will appear when the sync finishes.' : 'Manual request'}
        </div>
      </div>
    </div>
  );

  return (
    <Dialog
      variant="drawer"
      size="drawer"
      onClose={requestClose}
      header={header}
      closeOnBackdrop
      footer={(
        <>
          <span className="dialog-footer-start">
            {isDirty ? <span className="unsaved-indicator">Unsaved changes</span> : `Added ${formatDateTime(request.added_date, 'without a date')}`}
          </span>
          {isDirty && <button type="button" className="btn btn-ghost" onClick={() => setForm(baseline)} disabled={isSaving}>Discard</button>}
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!isDirty || isSaving}>
            {isSaving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
            {isSaving ? 'Saving…' : 'Save'}
            <span className="btn-kbd">Ctrl+S</span>
          </button>
        </>
      )}
    >
      <div
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            void save();
          }
        }}
        style={{ display: 'contents' }}
      >
        <div className="tabs" role="tablist" style={{ margin: '0 calc(var(--space-5) * -1)' }}>
          {[['details', 'Details'], ['beatmap', request.is_osu_link ? `Difficulties${difficulties?.length ? ` (${difficulties.length})` : ''}` : 'Beatmap'], ['history', 'History']].map(([key, label]) => (
            <button key={key} type="button" role="tab" className="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>

        {tab === 'details' && (
          <>
            <div className="drawer-grid">
              <div className="field">
                <label className="field-label" htmlFor="drawer-status">Status</label>
                <select id="drawer-status" className="input" value={form.request_status} onChange={event => set('request_status', event.target.value)}>
                  {REQUEST_STATUSES.map(status => <option key={status} value={status}>{status} — {REQUEST_STATUS_HINTS[status]}</option>)}
                </select>
              </div>
              <div className="field">
                <span className="field-label">Priority</span>
                <div className="priority-picker" role="group" aria-label="Priority">
                  {[...PRIORITIES].reverse().map(priority => (
                    <button key={priority} type="button" className={priorityClass(priority)} aria-pressed={form.priority === priority} onClick={() => set('priority', priority)}>{priority}</button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="drawer-deadline">Deadline</label>
                <div className="view-actions" style={{ flexWrap: 'nowrap' }}>
                  <input id="drawer-deadline" type="date" className="input" value={form.deadline} onChange={event => set('deadline', event.target.value)} />
                  {form.deadline && <button type="button" className="btn btn-ghost btn-icon" onClick={() => set('deadline', '')} aria-label="Clear deadline" title="Clear deadline"><X size={15} /></button>}
                </div>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="drawer-added">Added</label>
                <div className="view-actions" style={{ flexWrap: 'nowrap' }}>
                  <input id="drawer-added" type="date" className="input" value={form.added_date} onChange={event => set('added_date', event.target.value)} />
                  {request.is_osu_link && (
                    <button type="button" className="btn btn-secondary" onClick={useOsuDate} disabled={Boolean(busyAction)} title="Use the map’s ranked/loved date, or its last-updated date">
                      {busyAction === 'date' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}osu! date
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="field">
              <span className="field-label">Categories</span>
              <div className="category-editor">
                {form.categories.filter(category => !category.archived || category.checked).map((category, index) => (
                  <div key={category.id} className="category-editor-item" data-checked={category.checked}>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={category.checked}
                        onChange={() => set('categories', form.categories.map(item => (item.id === category.id ? { ...item, checked: !item.checked } : item)))}
                      />
                      {category.name}{category.archived && <span className="muted">(archived)</span>}
                    </label>
                    {category.checked && category.systemKey === 'others' && (
                      <div className="category-editor-body">
                        <input className="input input-sm" value={category.otherText} placeholder="What kind of work?" onChange={event => set('categories', form.categories.map(item => (item.id === category.id ? { ...item, otherText: event.target.value } : item)))} />
                      </div>
                    )}
                    {category.checked && isGuestCategory(category) && index >= 0 && (
                      <div className="category-editor-body">
                        {request.is_osu_link && (
                          <>
                            <span className="field-hint">
                              {uploadedSelections.length
                                ? `Yours: ${yourDifficulties.map(difficulty => difficulty.name).join(', ') || `${uploadedSelections.length} uploaded`}. `
                                : 'No uploaded difficulty marked as yours. '}
                              <button type="button" className="btn-link" onClick={() => setTab('beatmap')}>Choose in Difficulties</button>
                            </span>
                          </>
                        )}
                        {manualRows.map(({ row, index: rowIndex }) => (
                          <div key={rowIndex} className="guest-diff-row">
                            <select className="input input-sm" value={row.gamemode || 'osu'} onChange={event => updateGuestRow(rowIndex, { gamemode: event.target.value })} aria-label="Game mode">
                              {GAMEMODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                            </select>
                            <input className="input input-sm" placeholder="Difficulty name" value={row.difficulty_name || ''} onChange={event => updateGuestRow(rowIndex, { difficulty_name: event.target.value })} />
                            <input className="input input-sm" type="number" step="0.01" min="0" placeholder="Target ★" value={row.target_sr ?? ''} onChange={event => updateGuestRow(rowIndex, { target_sr: event.target.value })} />
                            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => set('guest_difficulties', form.guest_difficulties.filter((_, itemIndex) => itemIndex !== rowIndex))} aria-label="Remove difficulty"><X size={14} /></button>
                          </div>
                        ))}
                        <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set('guest_difficulties', [...form.guest_difficulties, createManualGuestDifficulty()])}>
                          <Plus size={13} />Add an unuploaded difficulty
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="drawer-tags">Tags</label>
              <TagInput id="drawer-tags" value={form.tags} onChange={tags => set('tags', tags)} suggestions={tagSuggestions} placeholder="Add a tag…" />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="drawer-notes">Notes</label>
              <textarea id="drawer-notes" className="input" style={{ minHeight: 110 }} value={form.notes} onChange={event => set('notes', event.target.value)} placeholder="Anything you need to remember about this request…" />
            </div>

            <div className="field">
              <span className="field-label">Requested by</span>
              {requesterProfile ? (
                <button type="button" className="person-card" onClick={() => openExternal(requesterProfile)} title="Open osu! profile">
                  <Avatar src={request.requester_avatar} name={request.requester_username} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 650 }}>{request.requester_username || 'Anonymous'}</div>
                    <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                      {request.requester_country && <span className="country-flag" style={{ marginRight: 6 }}>{countryCodeToFlag(request.requester_country)}</span>}
                      {request.requester_is_creator ? 'Set host' : 'osu! profile'}
                    </div>
                  </span>
                  <ExternalLink size={14} className="muted" />
                </button>
              ) : !request.is_osu_link ? null : (
                <div className="person-card"><Avatar name={request.requester_username} /><span>{request.requester_username || 'Anonymous'}</span></div>
              )}
              {!request.is_osu_link && (
                <input className="input" value={form.requester_username} onChange={event => set('requester_username', event.target.value)} placeholder="Requester’s osu! username" aria-label="Requester username" />
              )}
              <div className="field-row">
                <input className="input" value={form.osu_profile_link} onChange={event => set('osu_profile_link', event.target.value)} placeholder="Requester’s osu! profile link" aria-label="Requester osu! profile link" />
                <input className="input" value={form.discord_link} onChange={event => set('discord_link', event.target.value)} placeholder="Discord message or server link" aria-label="Discord link" />
              </div>
              {form.discord_link && /^https?:\/\//i.test(form.discord_link) && (
                <button type="button" className="btn-link" style={{ alignSelf: 'flex-start', fontSize: 'var(--text-sm)' }} onClick={() => openExternal(form.discord_link)}>Open Discord link<ExternalLink size={12} /></button>
              )}
            </div>

            {!request.is_osu_link && (
              <div className="panel-inset form-section">
                <h3 className="form-section-title">Map details</h3>
                <div className="field-row">
                  <div className="field"><label className="field-label" htmlFor="drawer-artist">Artist</label><input id="drawer-artist" className="input" value={form.artist} onChange={event => set('artist', event.target.value)} /></div>
                  <div className="field"><label className="field-label" htmlFor="drawer-title">Title</label><input id="drawer-title" className="input" value={form.title} onChange={event => set('title', event.target.value)} /></div>
                  <div className="field"><label className="field-label" htmlFor="drawer-creator">Mapper</label><input id="drawer-creator" className="input" value={form.creator} onChange={event => set('creator', event.target.value)} /></div>
                  <div className="field"><label className="field-label" htmlFor="drawer-difficulty">Difficulty</label><input id="drawer-difficulty" className="input" value={form.difficulty_name} onChange={event => set('difficulty_name', event.target.value)} /></div>
                </div>
                {request.input_link && (
                  <button type="button" className="btn-link" style={{ alignSelf: 'flex-start' }} onClick={() => openExternal(request.input_link)}>Open the saved link<ExternalLink size={12} /></button>
                )}
                <div className="field">
                  <label className="field-label" htmlFor="drawer-link-osu">Uploaded to osu!?</label>
                  <div className="view-actions" style={{ flexWrap: 'nowrap' }}>
                    <div className="input-group" style={{ flex: 1 }}>
                      <Link2 size={15} />
                      <input id="drawer-link-osu" className="input" value={linkToOsu} onChange={event => setLinkToOsu(event.target.value)} placeholder="https://osu.ppy.sh/beatmapsets/…" />
                    </div>
                    <button type="button" className="btn btn-secondary" onClick={linkManual} disabled={!linkToOsu.trim() || Boolean(busyAction)}>
                      {busyAction === 'link' ? <Loader2 size={14} className="spin" /> : null}Link
                    </button>
                  </div>
                  <span className="field-hint">Keeps this request’s status, notes, tags, deadline, and categories, and starts syncing from osu!.</span>
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'beatmap' && (
          <>
            {request.is_osu_link ? (
              <>
                {hasGuestCategory && (
                  <div className="callout callout-info">
                    <AlertCircle size={16} />
                    <span>Click the difficulties you’re responsible for, then save. {connectedAccount ? 'Difficulties uploaded under your account are marked “Yours”.' : 'Add your osu! account in Settings to spot your difficulties automatically.'}</span>
                  </div>
                )}
                {difficulties === null ? (
                  <div className="diff-grid">{[0, 1, 2].map(key => <div key={key} className="skeleton" style={{ height: 86 }} />)}</div>
                ) : difficulties.length === 0 ? (
                  <p className="muted">{pending ? 'Difficulties will appear when the sync from osu! finishes.' : 'No difficulty details are cached yet. Use Refresh from osu! above.'}</p>
                ) : (
                  <div className="diff-grid">
                    {[...difficulties].sort((a, b) => {
                      // Your marked or owned difficulties first, then by star rating.
                      const rank = difficulty => (isDifficultySelected(form.guest_difficulties, difficulty.id) || isConnectedUsersDifficulty(difficulty, connectedAccount) ? 0 : 1);
                      return rank(a) - rank(b) || (Number(a.stars) || 0) - (Number(b.stars) || 0);
                    }).map(difficulty => (
                      <DifficultyCard
                        key={difficulty.id}
                        difficulty={difficulty}
                        connectedAccount={connectedAccount}
                        selectable={hasGuestCategory}
                        selected={isDifficultySelected(form.guest_difficulties, difficulty.id)}
                        onToggle={() => toggleUploaded(difficulty)}
                      />
                    ))}
                  </div>
                )}
                <div className="field">
                  <span className="field-label">Beatmapset</span>
                  <div className="link-list">
                    <button type="button" onClick={() => openExternal(beatmapsetUrl(request.beatmapset_id))}><ExternalLink size={14} />Beatmap page<span className="muted" style={{ marginLeft: 'auto' }}>#{request.beatmapset_id}</span></button>
                    <button type="button" onClick={() => openExternal(beatmapsetDiscussionUrl(request.beatmapset_id))}><MessageSquare size={14} />Modding discussion</button>
                    <button type="button" onClick={() => setShowMapsetChange(open => !open)}><Replace size={14} />Change to a different beatmapset…</button>
                  </div>
                  {showMapsetChange && (
                    <div className="panel-inset form-section">
                      <span className="field-hint">Use this when the mapper re-uploaded the set. Status, notes, tags, deadline, and categories stay; guest difficulties that no longer exist are kept as manual entries.</span>
                      <div className="view-actions" style={{ flexWrap: 'nowrap' }}>
                        <input className="input" value={mapsetLink} onChange={event => setMapsetLink(event.target.value)} placeholder="New beatmapset link or ID" autoFocus />
                        <button type="button" className="btn btn-primary" onClick={changeMapset} disabled={!mapsetLink.trim() || Boolean(busyAction)}>
                          {busyAction === 'mapset' && <Loader2 size={14} className="spin" />}Change
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => { setShowMapsetChange(false); setMapsetLink(''); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="muted">This request isn’t linked to osu! yet. Link it from the Details tab once the map is uploaded.</p>
            )}
          </>
        )}

        {tab === 'history' && (
          history === null ? <div className="skeleton" style={{ height: 120 }} /> : history.length === 0 ? <p className="muted">No changes recorded yet.</p> : (
            <div className="history-list">
              {history.map(entry => (
                <div key={entry.id} className="history-item">
                  <div className="history-item-body">
                    <span className="history-item-title">{HISTORY_LABELS[entry.action_type] || entry.action_type.replaceAll('_', ' ').replace(/^\w/, character => character.toUpperCase())}</span>
                    {entry.details && <span className="history-item-detail">{entry.details}</span>}
                    <span className="history-item-time">{formatDateTime(entry.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </Dialog>
  );
}
