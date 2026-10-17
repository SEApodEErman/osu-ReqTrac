import React from 'react';
import { ChevronDown, Flag, Star } from 'lucide-react';
import { starRatingColor, starRatingStyle } from '../../utils/starRating';
import { PRIORITIES, REQUEST_STATUSES, priorityClass, statusClass } from '../../utils/requestConstants';

export function StarBadge({ stars, muted = false, title }) {
  const value = Number(stars);
  if (!(value > 0)) return null;
  return (
    <span className="star-badge" style={starRatingStyle(value, { muted })} title={title || `${value.toFixed(2)} stars`}>
      <Star size={9} fill="currentColor" strokeWidth={0} aria-hidden="true" />
      {value.toFixed(2)}
    </span>
  );
}

// Tiny bars for each guest difficulty, coloured by star rating.
export function DifficultyStrip({ difficulties = [], limit = 8 }) {
  if (!difficulties.length) return null;
  return (
    <span className="diff-strip" aria-label={`${difficulties.length} guest difficulties`}>
      {difficulties.slice(0, limit).map((difficulty, index) => {
        const color = starRatingColor(Number(difficulty.stars) || 0);
        return (
          <span
            key={difficulty.id || difficulty.assignment_id || `${difficulty.mode}-${difficulty.name}-${index}`}
            title={`${difficulty.name || 'Unnamed difficulty'} · ${Number(difficulty.stars || 0).toFixed(2)}★${difficulty.pending ? ' (not uploaded)' : ''}`}
            style={{ borderColor: color, background: difficulty.pending ? 'transparent' : color }}
          />
        );
      })}
      {difficulties.length > limit && <small className="muted">+{difficulties.length - limit}</small>}
    </span>
  );
}

export function StatusPill({ status }) {
  return <span className={`pill pill-dot ${statusClass(status)}`}>{status}</span>;
}

export function PriorityFlag({ priority }) {
  const value = priority || 'Low';
  return (
    <span className={`priority-flag ${priorityClass(value)}`}>
      <Flag size={12} fill={value === 'High' ? 'currentColor' : 'none'} aria-hidden="true" />
      {value}
    </span>
  );
}

// A status pill that is also a native select, for fast inline triage.
export function StatusSelect({ value, onChange, label = 'Request status' }) {
  return (
    <span className={`inline-select ${statusClass(value)}`} onClick={event => event.stopPropagation()}>
      <select className={`pill ${statusClass(value)}`} value={value} onChange={event => onChange(event.target.value)} aria-label={label}>
        {REQUEST_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
      </select>
      <ChevronDown size={11} aria-hidden="true" />
    </span>
  );
}

export function PrioritySelect({ value, onChange }) {
  const current = value || 'Low';
  return (
    <span className={`inline-select ${priorityClass(current)}`} onClick={event => event.stopPropagation()}>
      <select className={`pill ${priorityClass(current)}`} value={current} onChange={event => onChange(event.target.value)} aria-label="Priority">
        {PRIORITIES.map(priority => <option key={priority} value={priority}>{priority}</option>)}
      </select>
      <ChevronDown size={11} aria-hidden="true" />
    </span>
  );
}
