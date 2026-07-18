import React, { useState } from 'react';
import { FileSpreadsheet, X } from 'lucide-react';

const IMPORT_CATEGORY_NAMES = ['Hitsounds', 'Guest Difficulties', 'Storyboards', 'Others'];

export default function MultipleRequestsImport({
  onImportBeatmapLinks,
  onNotify = () => {},
  onToggle,
  defaultCategory = 'All'
}) {
  const getDefaultCategories = () => {
    const defaults = {
      Hitsounds: true,
      'Guest Difficulties': false,
      Storyboards: false,
      Others: false
    };
    if (defaultCategory !== 'All' && defaultCategory in defaults) {
      defaults[defaultCategory] = true;
    }
    return defaults;
  };

  const [linksText, setLinksText] = useState('');
  const [isImportingLinks, setIsImportingLinks] = useState(false);
  const [importCategories, setImportCategories] = useState(getDefaultCategories);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!linksText.trim()) return;

    const selectedCategories = IMPORT_CATEGORY_NAMES.filter((category) => importCategories[category]);
    if (selectedCategories.length === 0) {
      onNotify('Please select at least one request category.', 'warning');
      return;
    }

    setIsImportingLinks(true);
    try {
      const success = await onImportBeatmapLinks(linksText, selectedCategories);
      if (success) setLinksText('');
    } catch (error) {
      console.error(error);
    } finally {
      setIsImportingLinks(false);
    }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderLeft: '4px solid var(--req-working)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileSpreadsheet size={18} style={{ color: 'var(--req-working)' }} />
          Add Multiple Requests
        </h3>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Close Add Multiple Requests"
          style={{ color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: '4px', border: 'none', background: 'transparent' }}
        >
          <X size={16} />
        </button>
      </div>

      <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
        Paste one osu! beatmap link per line to import multiple requests at once. Imported requests intentionally have no added date.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>
            Paste beatmap links (one per line)
          </label>
          <textarea
            className="input-text"
            placeholder={'https://osu.ppy.sh/beatmapsets/123456\nhttps://osu.ppy.sh/beatmaps/789012'}
            value={linksText}
            onChange={(event) => setLinksText(event.target.value)}
            style={{ minHeight: '120px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
          />
        </div>

        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>
            Request Categories
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
            {IMPORT_CATEGORY_NAMES.map((category) => (
              <label key={category} className="checkbox-container">
                <input
                  type="checkbox"
                  checked={importCategories[category]}
                  onChange={() => setImportCategories((current) => ({
                    ...current,
                    [category]: !current[category]
                  }))}
                />
                <span className="checkmark" />
                <span style={{ fontSize: '13px' }}>{category}</span>
              </label>
            ))}
          </div>
        </div>

        <button type="submit" className="btn-primary" disabled={isImportingLinks || !linksText.trim()} style={{ width: 'fit-content' }}>
          {isImportingLinks ? 'Importing...' : 'Import Requests'}
        </button>
      </form>
    </div>
  );
}
