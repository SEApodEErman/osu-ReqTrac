import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, Link2, Loader2, Plus, X } from 'lucide-react';
import Dialog from './ui/Dialog';
import TagInput from './TagInput';
import { StarBadge } from './ui/Badges';
import { api } from '../api/client';
import { beatmapsetIdFromLink, isOsuBeatmapLink } from '../utils/osuLinks';
import { todayInputValue } from '../utils/dates';
import { GAMEMODES, PRIORITIES, priorityClass } from '../utils/requestConstants';
import {
  addUploadedGuestDifficulty,
  createManualGuestDifficulty,
  findConnectedUserDifficulties,
  isDifficultySelected,
  isUploadedGuestDifficulty,
} from '../utils/guestDifficulties';

const LOOKUP_DELAY_MS = 350;
const INITIAL_STATUSES = [
  { value: 'Considering', hint: 'Not decided yet' },
  { value: 'Accepted', hint: 'Agreed to do it' },
  { value: 'Working', hint: 'Already started' },
];

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return todayInputValue(date);
}

function initialCategorySelection(categories, lastCategories, defaultCategoryId) {
  const selection = {};
  for (const category of categories) {
    const remembered = lastCategories?.[category.id] ?? lastCategories?.[category.name];
    selection[category.id] = remembered === undefined ? category.system_key === 'hitsounds' : Boolean(remembered);
  }
  if (defaultCategoryId && selection[defaultCategoryId] !== undefined) {
    // Adding from a category page always includes that category.
    selection[defaultCategoryId] = true;
  }
  return selection;
}

export default function AddRequestDialog({
  initialLink = '',
  categories,
  tagSuggestions,
  defaultCategoryId,
  lastCategories,
  connectedAccount,
  isConfigured,
  onRememberCategories,
  onCreate,
  onAddToExisting,
  onOpenRequest,
  onClose,
  onNotify,
}) {
  const [link, setLink] = useState(initialLink);
  const [lookup, setLookup] = useState({ state: 'idle', data: null, error: '' });
  const [selectedCategories, setSelectedCategories] = useState(() => initialCategorySelection(categories, lastCategories, defaultCategoryId));
  const [otherText, setOtherText] = useState('');
  const [manual, setManual] = useState({ artist: '', title: '', creator: '', difficulty: '' });
  const [requester, setRequester] = useState('');
  const [requesterTouched, setRequesterTouched] = useState(false);
  const [status, setStatus] = useState('Accepted');
  const [priority, setPriority] = useState('Low');
  const [deadline, setDeadline] = useState('');
  const [tags, setTags] = useState([]);
  const [notes, setNotes] = useState('');
  const [guestDifficulties, setGuestDifficulties] = useState([]);
  const [showDetails, setShowDetails] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duplicate, setDuplicate] = useState(null);
  const [formError, setFormError] = useState('');
  const linkRef = useRef(null);

  const trimmedLink = link.trim();
  const isOsuLink = isOsuBeatmapLink(trimmedLink);
  const guestCategory = categories.find(category => category.system_key === 'guest_difficulties');
  const othersCategory = categories.find(category => category.system_key === 'others');
  const wantsGuestDifficulties = Boolean(guestCategory && selectedCategories[guestCategory.id]);
  const difficulties = useMemo(() => lookup.data?.difficulties || [], [lookup.data]);

  useEffect(() => {
    if (!isOsuLink) {
      setLookup({ state: 'idle', data: null, error: '' });
      setGuestDifficulties(rows => rows.filter(row => !isUploadedGuestDifficulty(row)));
      return undefined;
    }
    if (!isConfigured) {
      setLookup({ state: 'unconfigured', data: null, error: '' });
      return undefined;
    }
    const controller = new AbortController();
    setLookup(current => ({ state: 'loading', data: current.data, error: '' }));
    const timer = window.setTimeout(async () => {
      window.dispatchEvent(new Event('reqtrac:api-activity'));
      try {
        const data = await api.get(`/api/requests/beatmap-info?link=${encodeURIComponent(trimmedLink)}`, { signal: controller.signal });
        setLookup({ state: 'ready', data, error: '' });
        if (!requesterTouched) setRequester(data.creatorUsername || data.creator || '');
        const owned = findConnectedUserDifficulties(data.difficulties || [], connectedAccount);
        setGuestDifficulties(rows => owned.reduce(
          (current, difficulty) => addUploadedGuestDifficulty(current, difficulty),
          rows.filter(row => !isUploadedGuestDifficulty(row)),
        ));
      } catch (error) {
        if (controller.signal.aborted) return;
        setLookup({
          state: error.status === 404 ? 'missing' : 'error',
          data: null,
          error: error.status === 404
            ? 'osu! has no beatmap at this link. It may have been deleted — check the link.'
            : `Couldn’t look this map up (${error.message}). You can still add it; details will sync later.`,
        });
      }
    }, LOOKUP_DELAY_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // requesterTouched/connectedAccount are read at lookup time on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured, isOsuLink, trimmedLink]);

  const toggleCategory = (id) => setSelectedCategories(current => ({ ...current, [id]: !current[id] }));

  const buildCategoryPayload = () => categories
    .filter(category => selectedCategories[category.id])
    .map(category => ({
      category_id: category.id,
      name: category.name,
      other_text: category.system_key === 'others' ? otherText : null,
      status: 'Pending',
    }));

  const buildPayload = (force = false) => {
    const categoryPayload = buildCategoryPayload();
    const payload = {
      categories: categoryPayload,
      request_status: status,
      priority,
      deadline: deadline || null,
      notes: notes.trim() || null,
      tags,
      guest_difficulties: wantsGuestDifficulties
        ? guestDifficulties.filter(row => isUploadedGuestDifficulty(row) || String(row.difficulty_name || '').trim() || String(row.target_sr || '').trim())
        : [],
      ...(force ? { force: true } : {}),
    };
    if (isOsuLink) {
      payload.link = trimmedLink;
      payload.requester_username = requester.trim() || null;
    } else {
      payload.link = trimmedLink || null;
      payload.artist = manual.artist.trim();
      payload.title = manual.title.trim();
      payload.creator = manual.creator.trim();
      payload.difficulty = manual.difficulty.trim() || null;
      payload.requester_username = requester.trim() || manual.creator.trim() || 'Anonymous';
    }
    return payload;
  };

  const resetForAnother = () => {
    setLink('');
    setLookup({ state: 'idle', data: null, error: '' });
    setManual({ artist: '', title: '', creator: '', difficulty: '' });
    setRequester('');
    setRequesterTouched(false);
    setDeadline('');
    setTags([]);
    setNotes('');
    setGuestDifficulties([]);
    setDuplicate(null);
    setFormError('');
    window.setTimeout(() => linkRef.current?.focus(), 0);
  };

  const finish = (createdTitle, requestId) => {
    onRememberCategories(Object.fromEntries(categories.map(category => [category.id, Boolean(selectedCategories[category.id])])));
    onNotify(`Added “${createdTitle}”.`, 'success', requestId ? { action: { label: 'Open', onClick: () => onOpenRequest(requestId) } } : {});
    if (keepOpen) resetForAnother();
    else onClose();
  };

  const submit = async (force = false) => {
    if (isSubmitting) return;
    setFormError('');
    if (!buildCategoryPayload().length) {
      setFormError('Pick at least one category so you know what was requested.');
      return;
    }
    if (isOsuLink && lookup.state === 'missing') {
      setFormError(lookup.error);
      return;
    }
    if (!isOsuLink && (!manual.artist.trim() || !manual.title.trim() || !manual.creator.trim())) {
      setFormError('Without an osu! link, enter the artist, title, and mapper.');
      setShowDetails(true);
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await onCreate(buildPayload(force));
      if (result.ok) {
        finish(lookup.data?.title || manual.title.trim() || 'request', result.requestId);
      } else if (result.reason === 'duplicate') {
        setDuplicate({ requestId: result.requestId, message: result.message });
      } else {
        setFormError(result.message || 'Couldn’t add the request.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const addToExisting = async () => {
    setIsSubmitting(true);
    try {
      const result = await onAddToExisting(duplicate.requestId, buildCategoryPayload());
      if (result.ok) finish(lookup.data?.title || 'request', duplicate.requestId);
      else setFormError(result.message || 'Couldn’t update the existing request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleUploaded = (difficulty) => {
    setGuestDifficulties(rows => (isDifficultySelected(rows, difficulty.id)
      ? rows.filter(row => Number(row.beatmap_id) !== Number(difficulty.id))
      : addUploadedGuestDifficulty(rows, difficulty)));
  };

  const manualRows = guestDifficulties.map((row, index) => ({ row, index })).filter(({ row }) => !isUploadedGuestDifficulty(row));
  const updateGuestRow = (index, patch) => setGuestDifficulties(rows => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  const starValues = difficulties.map(difficulty => Number(difficulty.stars) || 0);

  return (
    <Dialog
      title="Add request"
      description="Paste a beatmap link and ReqTrac fills in the rest."
      size="lg"
      onClose={onClose}
      busy={isSubmitting}
      closeOnBackdrop={!trimmedLink && !notes}
      initialFocusRef={linkRef}
      footer={(
        <>
          <label className="checkbox dialog-footer-start">
            <input type="checkbox" checked={keepOpen} onChange={event => setKeepOpen(event.target.checked)} />
            Add another after this one
          </label>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={isSubmitting || (isOsuLink && lookup.state === 'loading')}>
            {isSubmitting ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
            {isSubmitting ? 'Adding…' : 'Add request'}
            <span className="btn-kbd">Ctrl+Enter</span>
          </button>
        </>
      )}
    >
      <form
        className="form-section"
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="add-request-link">Link</label>
          <div className="input-group">
            <Link2 size={16} />
            <input
              id="add-request-link"
              ref={linkRef}
              className="input link-input"
              value={link}
              onChange={event => { setLink(event.target.value); setDuplicate(null); setFormError(''); }}
              placeholder="https://osu.ppy.sh/beatmapsets/…"
              autoComplete="off"
              spellCheck="false"
            />
          </div>
          {!trimmedLink && <span className="field-hint">Not uploaded yet? Leave this empty, or paste a Drive or Discord link, and enter the details yourself.</span>}
          {trimmedLink && !isOsuLink && <span className="field-hint">Not an osu! beatmap link — enter the details below.</span>}
        </div>

        {isOsuLink && lookup.state === 'loading' && !lookup.data && (
          <div className="beatmap-preview" aria-busy="true">
            <div className="skeleton" style={{ width: 120, aspectRatio: '7 / 4' }} />
            <div><div className="skeleton" style={{ height: 14, width: '60%' }} /><div className="skeleton" style={{ height: 11, width: '40%', marginTop: 8 }} /></div>
          </div>
        )}
        {isOsuLink && lookup.data && (
          <div className="beatmap-preview" style={{ opacity: lookup.state === 'loading' ? 0.6 : 1 }}>
            <img src={lookup.data.coverUrl} alt="" />
            <div style={{ minWidth: 0 }}>
              <div className="beatmap-preview-title">{lookup.data.title}</div>
              <div className="beatmap-preview-meta">{lookup.data.artist} · mapped by {lookup.data.creatorUsername || lookup.data.creator}</div>
              <div className="beatmap-preview-diffs">
                {lookup.data.status && <span className={`pill map-${String(lookup.data.status).toLowerCase()}`}>{lookup.data.status}</span>}
                <span className="pill">{difficulties.length} difficult{difficulties.length === 1 ? 'y' : 'ies'}</span>
                {starValues.length > 0 && <StarBadge stars={Math.max(...starValues)} title="Hardest difficulty" />}
              </div>
            </div>
          </div>
        )}
        {(lookup.state === 'missing' || lookup.state === 'error') && (
          <div className={`callout ${lookup.state === 'missing' ? 'callout-danger' : 'callout-warning'}`} role="alert"><AlertCircle size={16} /><span>{lookup.error}</span></div>
        )}
        {lookup.state === 'unconfigured' && (
          <div className="callout callout-warning">
            <AlertCircle size={16} />
            <span>
              {beatmapsetIdFromLink(trimmedLink)
                ? 'Connect the osu! API in Settings to fill in map details automatically. You can still add this link now; details sync once osu! is connected.'
                : 'This is a difficulty link, which needs the osu! API to find its beatmapset. Paste the beatmapset link instead, or connect osu! in Settings first.'}
            </span>
          </div>
        )}

        {duplicate && (
          <div className="callout callout-warning duplicate-callout" role="alert">
            <AlertCircle size={16} />
            <div>
              <strong>You already track this beatmapset.</strong>
              <div className="muted">Add the categories you picked to the existing request, open it, or track it separately.</div>
              <div className="view-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={addToExisting} disabled={isSubmitting}>Add categories to it</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { onOpenRequest(duplicate.requestId); onClose(); }}>Open existing</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void submit(true)} disabled={isSubmitting}>Track separately</button>
              </div>
            </div>
          </div>
        )}

        <div className="field">
          <span className="field-label">What was requested</span>
          <div className="chip-group" role="group" aria-label="Categories">
            {categories.map(category => (
              <button key={category.id} type="button" className="chip-toggle" aria-pressed={Boolean(selectedCategories[category.id])} onClick={() => toggleCategory(category.id)}>
                {selectedCategories[category.id] && <Check size={13} />}
                {category.name}
              </button>
            ))}
          </div>
          {othersCategory && selectedCategories[othersCategory.id] && (
            <input className="input" value={otherText} onChange={event => setOtherText(event.target.value)} placeholder="What kind of work? e.g. video editing" />
          )}
        </div>

        {wantsGuestDifficulties && (
          <div className="field">
            <span className="field-label">Your guest difficulties</span>
            {isOsuLink && difficulties.length > 0 && (
              <>
                <span className="field-hint">
                  {connectedAccount ? 'Difficulties you own are already selected. ' : ''}Click the ones you are responsible for.
                </span>
                <div className="chip-group">
                  {difficulties.map(difficulty => (
                    <button key={difficulty.id} type="button" className="chip-toggle" aria-pressed={isDifficultySelected(guestDifficulties, difficulty.id)} onClick={() => toggleUploaded(difficulty)}>
                      <StarBadge stars={difficulty.stars} />
                      {difficulty.name}
                    </button>
                  ))}
                </div>
              </>
            )}
            <span className="field-hint">{isOsuLink && difficulties.length ? 'Not uploaded yet? Add it here:' : 'Add the difficulties you’ll make:'}</span>
            {manualRows.map(({ row, index }) => (
              <div key={index} className="guest-diff-row">
                <select className="input input-sm" value={row.gamemode} onChange={event => updateGuestRow(index, { gamemode: event.target.value })} aria-label="Game mode">
                  {GAMEMODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                </select>
                <input className="input input-sm" placeholder="Difficulty name" value={row.difficulty_name} onChange={event => updateGuestRow(index, { difficulty_name: event.target.value })} />
                <input className="input input-sm" type="number" min="0" step="0.01" placeholder="Target ★" value={row.target_sr} onChange={event => updateGuestRow(index, { target_sr: event.target.value })} />
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setGuestDifficulties(rows => rows.filter((_, rowIndex) => rowIndex !== index))} aria-label="Remove difficulty"><X size={14} /></button>
              </div>
            ))}
            <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setGuestDifficulties(rows => [...rows, createManualGuestDifficulty()])}>
              <Plus size={13} />Add a difficulty
            </button>
          </div>
        )}

        {!isOsuLink && (
          <div className="field-row">
            <div className="field"><label className="field-label" htmlFor="manual-artist">Artist</label><input id="manual-artist" className="input" value={manual.artist} onChange={event => setManual(current => ({ ...current, artist: event.target.value }))} placeholder="e.g. Camellia" /></div>
            <div className="field"><label className="field-label" htmlFor="manual-title">Title</label><input id="manual-title" className="input" value={manual.title} onChange={event => setManual(current => ({ ...current, title: event.target.value }))} placeholder="e.g. Exit This Earth’s Atomosphere" /></div>
            <div className="field"><label className="field-label" htmlFor="manual-creator">Mapper</label><input id="manual-creator" className="input" value={manual.creator} onChange={event => setManual(current => ({ ...current, creator: event.target.value }))} placeholder="Who hosts the set" /></div>
            <div className="field"><label className="field-label" htmlFor="manual-difficulty">Difficulty <span className="optional">(optional)</span></label><input id="manual-difficulty" className="input" value={manual.difficulty} onChange={event => setManual(current => ({ ...current, difficulty: event.target.value }))} placeholder="e.g. Extra" /></div>
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <span className="field-label">Status</span>
            <div className="segmented" role="group" aria-label="Initial status">
              {INITIAL_STATUSES.map(option => (
                <button key={option.value} type="button" aria-pressed={status === option.value} onClick={() => setStatus(option.value)} title={option.hint}>{option.value}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">Priority</span>
            <div className="segmented" role="group" aria-label="Priority">
              {[...PRIORITIES].reverse().map(option => (
                <button key={option} type="button" className={priorityClass(option)} aria-pressed={priority === option} onClick={() => setPriority(option)}>{option}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="add-request-deadline">Deadline <span className="optional">(optional)</span></label>
          <div className="view-actions">
            <input id="add-request-deadline" type="date" className="input" style={{ width: 170 }} value={deadline} min={todayInputValue()} onChange={event => setDeadline(event.target.value)} />
            {[['1 week', 7], ['2 weeks', 14], ['1 month', 30]].map(([label, days]) => (
              <button key={label} type="button" className="btn btn-ghost btn-sm" onClick={() => setDeadline(addDays(days))}>In {label}</button>
            ))}
            {deadline && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeadline('')}>Clear</button>}
          </div>
        </div>

        <button type="button" className="disclosure" onClick={() => setShowDetails(open => !open)} aria-expanded={showDetails}>
          {showDetails ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          Requester, tags, and notes
        </button>
        {showDetails && (
          <>
            <div className="field">
              <label className="field-label" htmlFor="add-request-requester">Requested by</label>
              <input
                id="add-request-requester"
                className="input"
                value={requester}
                onChange={event => { setRequester(event.target.value); setRequesterTouched(true); }}
                placeholder={isOsuLink ? 'Defaults to the set’s mapper' : 'osu! username'}
              />
              <span className="field-hint">An osu! username links their profile and counts them in your top requesters.</span>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="add-request-tags">Tags</label>
              <TagInput id="add-request-tags" value={tags} onChange={setTags} suggestions={tagSuggestions} placeholder="e.g. collab, tourney, drum-heavy" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="add-request-notes">Notes</label>
              <textarea id="add-request-notes" className="input" value={notes} onChange={event => setNotes(event.target.value)} placeholder="Hitsound style, sample set, storyboard theme, anything you need to remember…" />
            </div>
          </>
        )}

        {formError && <div className="callout callout-danger" role="alert"><AlertCircle size={16} /><span>{formError}</span></div>}
      </form>
    </Dialog>
  );
}
