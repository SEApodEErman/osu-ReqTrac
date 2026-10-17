import React, { useMemo, useState } from 'react';
import { ArrowLeft, Check, DatabaseBackup, FileSpreadsheet, Link2, Loader2 } from 'lucide-react';
import Dialog from './ui/Dialog';
import SpreadsheetImportModal from './SpreadsheetImportModal';
import { extractOsuBeatmapLinks } from '../utils/osuLinks';

function LinksImport({ categories, defaultCategoryId, onImport, onBack, onClose }) {
  const [text, setText] = useState('');
  const [selected, setSelected] = useState(() => Object.fromEntries(categories.map(category => [
    category.id,
    defaultCategoryId ? category.id === defaultCategoryId : category.system_key === 'hitsounds',
  ])));
  const [isImporting, setIsImporting] = useState(false);
  const links = useMemo(() => extractOsuBeatmapLinks(text), [text]);
  const chosen = categories.filter(category => selected[category.id]);

  const submit = async () => {
    if (!links.length || !chosen.length || isImporting) return;
    setIsImporting(true);
    try {
      if (await onImport(links.join('\n'), chosen.map(category => category.name))) onClose();
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog
      title="Import beatmap links"
      description="Paste links from a Discord channel, a forum post, or a notes file. Anything that isn’t an osu! beatmap link is ignored."
      size="lg"
      onClose={onClose}
      busy={isImporting}
      closeOnBackdrop={!text}
      footer={(
        <>
          <button type="button" className="btn btn-ghost dialog-footer-start" onClick={onBack} disabled={isImporting}><ArrowLeft size={15} />Other import options</button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isImporting}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!links.length || !chosen.length || isImporting}>
            {isImporting && <Loader2 size={15} className="spin" />}
            {isImporting ? 'Importing…' : `Import ${links.length || ''} link${links.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    >
      <div className="field">
        <label className="field-label" htmlFor="import-links">Links</label>
        <textarea
          id="import-links"
          className="input"
          style={{ minHeight: 180, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 'var(--text-sm)' }}
          value={text}
          onChange={event => setText(event.target.value)}
          placeholder={'https://osu.ppy.sh/beatmapsets/123456\nhttps://osu.ppy.sh/beatmaps/789012'}
          data-autofocus
        />
        <span className="field-hint">
          {links.length ? `${links.length} beatmap link${links.length === 1 ? '' : 's'} found.` : 'No beatmap links found yet.'}
          {' '}Maps you already track are skipped. Imported requests have no added date — use “osu! dates” on them afterwards if you want one.
        </span>
      </div>
      <div className="field">
        <span className="field-label">Categories for every imported request</span>
        <div className="chip-group">
          {categories.map(category => (
            <button key={category.id} type="button" className="chip-toggle" aria-pressed={Boolean(selected[category.id])} onClick={() => setSelected(current => ({ ...current, [category.id]: !current[category.id] }))}>
              {selected[category.id] && <Check size={13} />}{category.name}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

export default function ImportDialog({ categories, defaultCategoryId, onImportLinks, onSpreadsheetImported, onOpenBackupSettings, onClose, onNotify }) {
  const [mode, setMode] = useState('choose');

  if (mode === 'links') {
    return <LinksImport categories={categories} defaultCategoryId={defaultCategoryId} onImport={onImportLinks} onBack={() => setMode('choose')} onClose={onClose} />;
  }
  if (mode === 'spreadsheet') {
    return <SpreadsheetImportModal categoryDefinitions={categories} onImported={onSpreadsheetImported} onNotify={onNotify} onClose={onClose} onBack={() => setMode('choose')} />;
  }

  return (
    <Dialog title="Import requests" description="Bring in requests you’re already tracking somewhere else." size="lg" onClose={onClose}>
      <div className="choice-grid">
        <button type="button" className="choice-card" onClick={() => setMode('links')} data-autofocus>
          <Link2 size={20} />
          <strong>Paste beatmap links</strong>
          <span>A list of osu! links from Discord, a forum thread, or a text file. Details sync from osu! in the background.</span>
        </button>
        <button type="button" className="choice-card" onClick={() => setMode('spreadsheet')}>
          <FileSpreadsheet size={20} />
          <strong>Spreadsheet or Google Sheet</strong>
          <span>CSV, Excel, or a public Google Sheet. You choose which column is the link, status, notes, deadline, and so on.</span>
        </button>
        <button type="button" className="choice-card" onClick={() => { onClose(); onOpenBackupSettings(); }} style={{ gridColumn: '1 / -1' }}>
          <DatabaseBackup size={20} />
          <strong>Restore a ReqTrac backup</strong>
          <span>Moving to a new computer? Restore a backup.json exported from ReqTrac. This replaces everything currently in the app.</span>
        </button>
      </div>
    </Dialog>
  );
}
