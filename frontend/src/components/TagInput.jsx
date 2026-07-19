import React, { useMemo, useState } from 'react';
import { Tag, X } from 'lucide-react';

export default function TagInput({ value = [], onChange, suggestions = [], placeholder = 'Add a tag…', compact = false }) {
  const [input, setInput] = useState('');
  const normalizedValue = Array.isArray(value) ? value : [];
  const available = useMemo(() => {
    const query = input.trim().toLowerCase();
    const selected = new Set(normalizedValue.map(tag => tag.toLowerCase()));
    return suggestions
      .map(tag => typeof tag === 'string' ? tag : tag.name)
      .filter(Boolean)
      .filter(tag => !selected.has(tag.toLowerCase()) && (!query || tag.toLowerCase().includes(query)))
      .slice(0, 8);
  }, [input, normalizedValue, suggestions]);

  const addTag = (rawTag) => {
    const tag = String(rawTag || '').trim().replace(/^,+|,+$/g, '');
    if (!tag) return;
    if (!normalizedValue.some(existing => existing.toLowerCase() === tag.toLowerCase())) {
      onChange([...normalizedValue, tag]);
    }
    setInput('');
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTag(input || available[0]);
    } else if (event.key === 'Backspace' && !input && normalizedValue.length > 0) {
      onChange(normalizedValue.slice(0, -1));
    }
  };

  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      {normalizedValue.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '6px' }}>
          {normalizedValue.map(tag => (
            <span key={tag.toLowerCase()} className="tag-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Tag size={10} />{tag}
              <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(normalizedValue.filter(item => item !== tag))} style={{ display: 'inline-flex', color: 'inherit' }}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        className="input-text"
        value={input}
        onChange={event => {
          const next = event.target.value;
          if (next.includes(',')) {
            const parts = next.split(',');
            const merged = [...normalizedValue];
            parts.slice(0, -1).map(tag => tag.trim()).filter(Boolean).forEach(tag => {
              if (!merged.some(existing => existing.toLowerCase() === tag.toLowerCase())) merged.push(tag);
            });
            onChange(merged);
            setInput(parts.at(-1));
          } else {
            setInput(next);
          }
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (input.trim()) addTag(input); }}
        placeholder={placeholder}
        style={compact ? { padding: '5px 8px', fontSize: '12px' } : undefined}
        autoComplete="off"
      />
      {input && available.length > 0 && (
        <div className="tag-suggestions" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', marginTop: '3px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', boxShadow: 'var(--shadow-lg)', maxHeight: '180px', overflowY: 'auto' }}>
          {available.map(tag => (
            <button key={tag.toLowerCase()} type="button" onMouseDown={event => event.preventDefault()} onClick={() => addTag(tag)} style={{ display: 'block', width: '100%', padding: '7px 9px', textAlign: 'left', color: 'var(--text-main)' }}>
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
