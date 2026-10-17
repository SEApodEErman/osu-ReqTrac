import React, { useId, useMemo, useState } from 'react';
import { Tag, X } from 'lucide-react';

export default function TagInput({ value = [], onChange, suggestions = [], placeholder = 'Add a tag…', compact = false, autoFocus = false, id }) {
  const [input, setInput] = useState('');
  // -1 until the user arrows into the suggestion list.
  const [highlighted, setHighlighted] = useState(-1);
  const listId = useId();
  const tags = Array.isArray(value) ? value : [];

  const available = useMemo(() => {
    const query = input.trim().toLowerCase();
    const selected = new Set(tags.map(tag => tag.toLowerCase()));
    return suggestions
      .map(tag => (typeof tag === 'string' ? tag : tag.name))
      .filter(Boolean)
      .filter(tag => !selected.has(tag.toLowerCase()) && (!query || tag.toLowerCase().includes(query)))
      .slice(0, 8);
  }, [input, suggestions, tags]);

  const addTag = (rawTag) => {
    const tag = String(rawTag || '').trim().replace(/^,+|,+$/g, '');
    if (tag && !tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) onChange([...tags, tag]);
    setInput('');
    setHighlighted(-1);
  };

  const showSuggestions = input.trim() && available.length > 0;

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown' && showSuggestions) {
      event.preventDefault();
      setHighlighted(index => (index + 1) % available.length);
    } else if (event.key === 'ArrowUp' && showSuggestions) {
      event.preventDefault();
      setHighlighted(index => (index <= 0 ? available.length - 1 : index - 1));
    } else if (event.key === 'Enter' || event.key === ',' || (event.key === 'Tab' && input.trim())) {
      if (!input.trim() && event.key !== ',') return;
      event.preventDefault();
      addTag(showSuggestions && highlighted >= 0 && event.key !== ',' ? available[highlighted] : input);
    } else if (event.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    } else if (event.key === 'Escape' && input) {
      event.stopPropagation();
      setInput('');
    }
  };

  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      {tags.length > 0 && (
        <div className="chip-group" style={{ marginBottom: 6 }}>
          {tags.map(tag => (
            <span key={tag.toLowerCase()} className="tag-chip">
              <Tag size={10} />{tag}
              <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter(item => item !== tag))}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <input
        id={id}
        type="text"
        className={`input${compact ? ' input-sm' : ''}`}
        value={input}
        autoFocus={autoFocus}
        onChange={(event) => {
          const next = event.target.value;
          setHighlighted(-1);
          if (!next.includes(',')) {
            setInput(next);
            return;
          }
          const parts = next.split(',');
          const merged = [...tags];
          parts.slice(0, -1).map(tag => tag.trim()).filter(Boolean).forEach(tag => {
            if (!merged.some(existing => existing.toLowerCase() === tag.toLowerCase())) merged.push(tag);
          });
          onChange(merged);
          setInput(parts.at(-1));
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (input.trim()) addTag(input); }}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={Boolean(showSuggestions)}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {showSuggestions && (
        <div id={listId} className="popover popover-below menu" role="listbox" style={{ left: 0, right: 0 }}>
          {available.map((tag, index) => (
            <button
              key={tag.toLowerCase()}
              type="button"
              role="option"
              aria-selected={index === highlighted}
              className="menu-item"
              style={index === highlighted ? { background: 'var(--hover-bg)' } : undefined}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => addTag(tag)}
            >
              <Tag size={12} />{tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
