import React, { useState } from 'react';
import { AlertCircle, ArrowLeft, Check, CheckCircle, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import Dialog from './ui/Dialog';
import { api } from '../api/client';
import { downloadTextFile } from '../utils/csv';

const FIELD_OPTIONS = [
  ['ignore', 'Don’t import'],
  ['link', 'Beatmap link'],
  ['artist', 'Artist'],
  ['title', 'Title'],
  ['creator', 'Mapper'],
  ['difficulty', 'Difficulty'],
  ['notes', 'Notes'],
  ['requester', 'Requester'],
  ['status', 'Status'],
  ['priority', 'Priority'],
  ['deadline', 'Deadline'],
  ['addedDate', 'Added date'],
  ['completedDate', 'Completed date'],
  ['discordLink', 'Discord link'],
  ['osuProfileLink', 'Requester profile link'],
  ['category', 'Category'],
];

const STEPS = [['source', 'Choose file'], ['mapping', 'Match columns'], ['preview', 'Review'], ['result', 'Done']];

export default function SpreadsheetImportModal({ onClose, onBack, onImported, onNotify = () => {}, categoryDefinitions = [] }) {
  const categoryNames = categoryDefinitions.map(category => category.name);
  const defaultCategoryName = categoryDefinitions.find(category => category.system_key === 'hitsounds')?.name || categoryNames[0] || '';
  const [file, setFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [worksheet, setWorksheet] = useState('');
  const [worksheets, setWorksheets] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [sampleRows, setSampleRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [defaultCategories, setDefaultCategories] = useState(defaultCategoryName ? [defaultCategoryName] : []);
  const [duplicateMode, setDuplicateMode] = useState('skip');
  const [step, setStep] = useState('source');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const send = (action, options = {}) => {
    const formData = new FormData();
    if (file) formData.append('file', file);
    if (sourceUrl.trim()) formData.append('sourceUrl', sourceUrl.trim());
    formData.append('action', action);
    formData.append('worksheet', options.worksheet ?? worksheet);
    formData.append('mapping', JSON.stringify(mapping));
    formData.append('defaultCategories', JSON.stringify(defaultCategories));
    formData.append('duplicateMode', duplicateMode);
    return api.post('/api/migration/import-spreadsheet', formData, { timeoutMs: 600000 });
  };

  const run = async (task) => {
    setIsBusy(true);
    setError('');
    try {
      await task();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const inspect = (selectedWorksheet = '') => {
    if (!file && !sourceUrl.trim()) {
      setError('Choose a CSV or Excel file, or paste a public Google Sheets link.');
      return;
    }
    void run(async () => {
      const data = await send('inspect', { worksheet: selectedWorksheet });
      setWorksheets(data.worksheets);
      setWorksheet(data.worksheet);
      setHeaders(data.headers);
      setSampleRows(data.sampleRows);
      setMapping(data.suggestedMapping);
      if (categoryNames.includes(data.worksheet)) setDefaultCategories([data.worksheet]);
      setStep('mapping');
    });
  };

  const showPreview = () => void run(async () => {
    setPreview(await send('preview'));
    setStep('preview');
  });

  const importRows = () => void run(async () => {
    const data = await send('import');
    setResult(data);
    setStep('result');
    await onImported?.();
    onNotify(`Imported ${data.imported} request${data.imported === 1 ? '' : 's'}.${data.metadataQueued ? ` ${data.metadataQueued} beatmapsets are syncing from osu!.` : ''}`, data.apiFailures ? 'warning' : 'success');
  });

  const mappedFields = Object.values(mapping).filter(value => value && value !== 'ignore');
  const hasRequiredMapping = mappedFields.includes('link') || mappedFields.some(field => ['artist', 'title', 'creator'].includes(field));
  const stepIndex = STEPS.findIndex(([key]) => key === step);

  const downloadErrors = () => {
    const csv = ['Row,Problem', ...result.errors.map(({ rowNumber, error: rowError }) => `${rowNumber},"${String(rowError).replace(/"/g, '""')}"`)].join('\r\n');
    downloadTextFile('reqtrac-import-problems.csv', csv);
  };

  let footer;
  if (step === 'source') {
    footer = (
      <>
        {onBack && <button type="button" className="btn btn-ghost dialog-footer-start" onClick={onBack} disabled={isBusy}><ArrowLeft size={15} />Other import options</button>}
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isBusy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => inspect()} disabled={isBusy || (!file && !sourceUrl.trim())}>
          {isBusy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}{isBusy ? 'Reading…' : 'Continue'}
        </button>
      </>
    );
  } else if (step === 'mapping') {
    footer = (
      <>
        <button type="button" className="btn btn-ghost dialog-footer-start" onClick={() => setStep('source')} disabled={isBusy}><ArrowLeft size={15} />Back</button>
        <button type="button" className="btn btn-primary" onClick={showPreview} disabled={isBusy || !hasRequiredMapping || defaultCategories.length === 0}>
          {isBusy && <Loader2 size={15} className="spin" />}{isBusy ? 'Checking rows…' : 'Review import'}
        </button>
      </>
    );
  } else if (step === 'preview') {
    footer = (
      <>
        <button type="button" className="btn btn-ghost dialog-footer-start" onClick={() => setStep('mapping')} disabled={isBusy}><ArrowLeft size={15} />Back to columns</button>
        <button type="button" className="btn btn-primary" onClick={importRows} disabled={isBusy || !preview?.validRows}>
          {isBusy && <Loader2 size={15} className="spin" />}{isBusy ? 'Importing…' : `Import ${preview?.validRows || 0} request${preview?.validRows === 1 ? '' : 's'}`}
        </button>
      </>
    );
  } else {
    footer = (
      <>
        {result?.errors?.length > 0 && <button type="button" className="btn btn-secondary dialog-footer-start" onClick={downloadErrors}>Download problem rows</button>}
        <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
      </>
    );
  }

  return (
    <Dialog
      title="Import from a spreadsheet"
      description={`Step ${stepIndex + 1} of ${STEPS.length}: ${STEPS[stepIndex][1]}`}
      size="xl"
      onClose={onClose}
      busy={isBusy}
      closeOnBackdrop={step === 'source' || step === 'result'}
      footer={footer}
    >
      <div className="setup-steps" aria-hidden="true">
        {STEPS.map(([key], index) => <span key={key} data-state={index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'todo'} />)}
      </div>

      {error && <div className="callout callout-danger" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}

      {step === 'source' && (
        <div className="choice-grid">
          <label className="choice-card" style={{ cursor: 'pointer' }}>
            <Upload size={20} />
            <strong>Upload a file</strong>
            <span>CSV, Excel .xlsx, or older .xls files.</span>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={event => { setFile(event.target.files?.[0] || null); setSourceUrl(''); }} style={{ marginTop: 6, fontSize: 'var(--text-sm)' }} />
            {file && <span style={{ color: 'var(--text-main)' }}><Check size={12} /> {file.name}</span>}
          </label>
          <div className="choice-card">
            <FileSpreadsheet size={20} />
            <strong>Use a public Google Sheet</strong>
            <span>Share it so anyone with the link can view, then paste the link.</span>
            <input className="input" style={{ marginTop: 6 }} placeholder="https://docs.google.com/spreadsheets/d/…" value={sourceUrl} onChange={event => { setSourceUrl(event.target.value); setFile(null); }} />
          </div>
        </div>
      )}

      {step === 'mapping' && (
        <>
          {worksheets.length > 1 && (
            <div className="field" style={{ maxWidth: 320 }}>
              <label className="field-label" htmlFor="import-worksheet">Sheet</label>
              <select id="import-worksheet" className="input" value={worksheet} onChange={event => inspect(event.target.value)} disabled={isBusy}>
                {worksheets.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          )}
          <p className="field-hint">Tell ReqTrac what each column holds. You need at least a beatmap link column, or artist, title, and mapper columns.</p>
          <div className="table-scroll" style={{ margin: 0, contain: 'none', maxHeight: 340 }}>
            <table className="simple-table" style={{ margin: '0' }}>
              <thead><tr><th style={{ padding: 10 }}>Column</th><th style={{ padding: 10 }}>First row</th><th style={{ padding: 10, width: 220 }}>Import as</th></tr></thead>
              <tbody>
                {headers.map((header, index) => (
                  <tr key={`${header}-${index}`}>
                    <td style={{ padding: '6px 10px', fontWeight: 600 }}>{header}</td>
                    <td className="muted truncate" style={{ padding: '6px 10px', maxWidth: 280 }}>{sampleRows[0]?.[index] || '—'}</td>
                    <td style={{ padding: '6px 10px' }}>
                      <select className="input input-sm" value={mapping[header] || 'ignore'} onChange={event => setMapping(current => ({ ...current, [header]: event.target.value }))} aria-label={`Import ${header} as`}>
                        {FIELD_OPTIONS.map(([value, label]) => <option key={value} value={value} disabled={value !== 'ignore' && value !== mapping[header] && mappedFields.includes(value)}>{label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="field">
            <span className="field-label">Categories for rows without a category column</span>
            <div className="chip-group">
              {categoryNames.map(category => (
                <button key={category} type="button" className="chip-toggle" aria-pressed={defaultCategories.includes(category)} onClick={() => setDefaultCategories(current => (current.includes(category) ? current.filter(value => value !== category) : [...current, category]))}>
                  {defaultCategories.includes(category) && <Check size={13} />}{category}
                </button>
              ))}
            </div>
          </div>
          <div className="field" style={{ maxWidth: 360 }}>
            <label className="field-label" htmlFor="import-duplicates">Maps you already track</label>
            <select id="import-duplicates" className="input" value={duplicateMode} onChange={event => setDuplicateMode(event.target.value)}>
              <option value="skip">Skip them</option>
              <option value="update">Update them with the spreadsheet’s values</option>
            </select>
          </div>
        </>
      )}

      {step === 'preview' && preview && (
        <>
          <div className="view-actions">
            <span className="pill">{preview.totalRows} rows</span>
            <span className="pill status-completed">{preview.validRows} ready</span>
            {preview.invalidRows.length > 0 && <span className="pill status-cancelled">{preview.invalidRows.length} with problems</span>}
          </div>
          {preview.invalidRows.length > 0 && (
            <div className="callout callout-warning">
              <AlertCircle size={16} />
              <div>
                Rows with problems are skipped:
                {preview.invalidRows.slice(0, 8).map(row => <div key={row.rowNumber} className="muted">Row {row.rowNumber}: {row.errors.join(' ')}</div>)}
                {preview.invalidRows.length > 8 && <div className="muted">…and {preview.invalidRows.length - 8} more.</div>}
              </div>
            </div>
          )}
          <div className="table-scroll" style={{ margin: 0, contain: 'none', maxHeight: 320 }}>
            <table className="simple-table">
              <thead><tr><th style={{ padding: 10 }}>Row</th><th style={{ padding: 10 }}>Link or title</th><th style={{ padding: 10 }}>Notes</th><th style={{ padding: 10 }}>Check</th></tr></thead>
              <tbody>
                {preview.previewRows.map(row => (
                  <tr key={row.rowNumber}>
                    <td style={{ padding: '6px 10px' }}>{row.rowNumber}</td>
                    <td className="truncate" style={{ padding: '6px 10px', maxWidth: 320 }}>{row.link || row.title || 'Manual request'}</td>
                    <td className="muted truncate" style={{ padding: '6px 10px', maxWidth: 240 }}>{row.notes || '—'}</td>
                    <td style={{ padding: '6px 10px', color: row.errors.length ? 'var(--danger)' : 'var(--success)' }}>{row.errors.join(' ') || 'Ready'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {step === 'result' && result && (
        <>
          <div className="callout callout-success"><CheckCircle size={16} /><span><strong>Imported {result.imported} request{result.imported === 1 ? '' : 's'}</strong>{result.updated ? `, updated ${result.updated}` : ''}.</span></div>
          <dl className="stat-list">
            <div><dt>Skipped (already tracked)</dt><dd>{result.skippedDuplicates}</dd></div>
            <div><dt>Rows with problems</dt><dd>{result.invalid}</dd></div>
            <div><dt>Syncing from osu!</dt><dd>{result.metadataQueued}</dd></div>
            <div><dt>Maps not found on osu!</dt><dd>{result.missingBeatmaps}</dd></div>
          </dl>
          {result.metadataQueued > 0 && <p className="field-hint">Your requests are in the list now. Titles, difficulties, and covers fill in as the background sync works through osu!’s rate limit — the indicator in the top bar shows progress.</p>}
          {result.errors.length > 0 && (
            <div className="panel-inset" style={{ maxHeight: 160, overflow: 'auto', fontSize: 'var(--text-sm)' }}>
              {result.errors.map((entry, index) => <div key={`${entry.rowNumber}-${index}`}>Row {entry.rowNumber}: {entry.error}</div>)}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
