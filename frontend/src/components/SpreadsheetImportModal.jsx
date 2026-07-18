import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, FileSpreadsheet, Upload, X } from 'lucide-react';

const FIELD_OPTIONS = [
  ['ignore', 'Ignore'],
  ['link', 'Beatmap Link'],
  ['artist', 'Artist'],
  ['title', 'Title'],
  ['creator', 'Creator'],
  ['difficulty', 'Difficulty'],
  ['notes', 'Notes'],
  ['requester', 'Requester'],
  ['status', 'Request Status'],
  ['priority', 'Priority'],
  ['deadline', 'Deadline'],
  ['addedDate', 'Added Date'],
  ['completedDate', 'Completed Date'],
  ['discordLink', 'Discord Link'],
  ['osuProfileLink', 'osu! Profile Link'],
  ['category', 'Category']
];

const CATEGORY_NAMES = ['Hitsounds', 'Guest Difficulties', 'Storyboards', 'Others'];

export default function SpreadsheetImportModal({ onClose, onImported, onNotify = () => {} }) {
  const [file, setFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [worksheet, setWorksheet] = useState('');
  const [worksheets, setWorksheets] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [sampleRows, setSampleRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [defaultCategories, setDefaultCategories] = useState(['Hitsounds']);
  const [duplicateMode, setDuplicateMode] = useState('skip');
  const [step, setStep] = useState('source');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !isBusy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isBusy, onClose]);

  const request = async (action, options = {}) => {
    const formData = new FormData();
    if (file) formData.append('file', file);
    if (sourceUrl.trim()) formData.append('sourceUrl', sourceUrl.trim());
    formData.append('action', action);
    formData.append('worksheet', options.worksheet ?? worksheet);
    formData.append('mapping', JSON.stringify(mapping));
    formData.append('defaultCategories', JSON.stringify(defaultCategories));
    formData.append('duplicateMode', duplicateMode);

    const response = await fetch('/api/migration/import-spreadsheet', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Spreadsheet import failed.');
    return data;
  };

  const inspect = async (selectedWorksheet = '') => {
    if (!file && !sourceUrl.trim()) {
      setError('Choose a CSV/Excel file or provide a public Google Sheets URL.');
      return;
    }
    setIsBusy(true);
    setError('');
    try {
      const data = await request('inspect', { worksheet: selectedWorksheet });
      setWorksheets(data.worksheets);
      setWorksheet(data.worksheet);
      setHeaders(data.headers);
      setSampleRows(data.sampleRows);
      setMapping(data.suggestedMapping);
      if (CATEGORY_NAMES.includes(data.worksheet)) setDefaultCategories([data.worksheet]);
      setStep('mapping');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const showPreview = async () => {
    setIsBusy(true);
    setError('');
    try {
      const data = await request('preview');
      setPreview(data);
      setStep('preview');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const importRows = async () => {
    setIsBusy(true);
    setError('');
    try {
      const data = await request('import');
      setResult(data);
      setStep('result');
      await onImported();
      onNotify(`Imported ${data.imported} requests. ${data.metadataQueued} beatmapsets are syncing in the background.`, data.apiFailures ? 'warning' : 'success');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const mappedFields = Object.values(mapping).filter(value => value && value !== 'ignore');
  const hasRequiredMapping = mappedFields.includes('link') || mappedFields.some(field => ['artist', 'title', 'creator'].includes(field));

  const changeMapping = (header, value) => {
    setMapping(current => ({ ...current, [header]: value }));
  };

  const toggleCategory = (category) => {
    setDefaultCategories(current => current.includes(category)
      ? current.filter(value => value !== category)
      : [...current, category]);
  };

  const downloadErrors = () => {
    const csv = ['Row,Error', ...result.errors.map(({ rowNumber, error: rowError }) => `${rowNumber},"${String(rowError).replace(/"/g, '""')}"`)].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = 'spreadsheet-import-errors.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) onClose();
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0, 0, 0, 0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="spreadsheet-import-title" style={{ width: 'min(920px, 100%)', maxHeight: 'min(800px, 100%)', overflow: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: 'var(--shadow-lg)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <FileSpreadsheet size={22} style={{ color: 'var(--req-completed)', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ flex: 1 }}>
            <h2 id="spreadsheet-import-title" style={{ fontSize: '19px', fontWeight: '700' }}>Import Requests from Spreadsheet</h2>
            <p style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>Map your existing columns, including remarks, before any requests are added.</p>
          </div>
          <button type="button" aria-label="Close spreadsheet import" onClick={onClose} disabled={isBusy} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--text-muted)' }}>
          {['1. Source', '2. Map columns', '3. Review', '4. Import'].map((label, index) => (
            <span key={label} style={{ color: (step === 'source' && index === 0) || (step === 'mapping' && index === 1) || (step === 'preview' && index === 2) || (step === 'result' && index === 3) ? 'var(--osu-pink)' : undefined, fontWeight: '600' }}>{label}</span>
          ))}
        </div>

        {error && <div style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(231, 76, 60, 0.35)', background: 'rgba(231, 76, 60, 0.1)', display: 'flex', gap: '8px', fontSize: '12px' }}><AlertCircle size={16} style={{ color: 'var(--priority-high)', flexShrink: 0 }} />{error}</div>}

        {step === 'source' && <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
            <div style={{ padding: '16px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: '8px' }}>
              <h3 style={{ fontSize: '14px', marginBottom: '8px' }}>Upload a file</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>CSV, Excel `.xlsx`, or legacy `.xls` files are supported.</p>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => { setFile(event.target.files?.[0] || null); setSourceUrl(''); }} style={{ fontSize: '12px', maxWidth: '100%' }} />
            </div>
            <div style={{ padding: '16px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: '8px' }}>
              <h3 style={{ fontSize: '14px', marginBottom: '8px' }}>Import a public Google Sheet</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>The sheet must be shared so anyone with the link can view it.</p>
              <input className="input-text" placeholder="https://docs.google.com/spreadsheets/d/..." value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); setFile(null); }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" className="btn-primary" onClick={() => inspect()} disabled={isBusy}><Upload size={16} />{isBusy ? 'Reading...' : 'Continue to column mapping'}</button></div>
        </>}

        {step === 'mapping' && <>
          {worksheets.length > 1 && <label style={{ fontSize: '12px', fontWeight: '600' }}>Worksheet<select className="input-text" value={worksheet} onChange={(event) => inspect(event.target.value)} disabled={isBusy} style={{ display: 'block', marginTop: '5px', minWidth: '240px' }}>{worksheets.map(name => <option key={name} value={name}>{name}</option>)}</select></label>}
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Choose what each source column means. Set unrelated data to <strong>Ignore</strong>; ignored columns are not validated or imported.</p>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead><tr style={{ background: 'var(--bg-sidebar)', textAlign: 'left' }}><th style={{ padding: '10px' }}>Spreadsheet column</th><th style={{ padding: '10px' }}>Example</th><th style={{ padding: '10px' }}>Import as</th></tr></thead>
              <tbody>{headers.map((header, index) => <tr key={`${header}-${index}`} style={{ borderTop: '1px solid var(--border)' }}><td style={{ padding: '8px 10px', fontWeight: '600' }}>{header}</td><td style={{ padding: '8px 10px', color: 'var(--text-muted)', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sampleRows[0]?.[index] || '—'}</td><td style={{ padding: '8px 10px' }}><select className="input-text" value={mapping[header] || 'ignore'} onChange={(event) => changeMapping(header, event.target.value)}>{FIELD_OPTIONS.map(([value, label]) => <option key={value} value={value} disabled={value !== 'ignore' && value !== mapping[header] && mappedFields.includes(value)}>{label}</option>)}</select></td></tr>)}</tbody>
            </table>
          </div>
          <div>
            <span style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '7px' }}>Default categories for rows without a Category column</span>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>{CATEGORY_NAMES.map(category => <label key={category} className="checkbox-container"><input type="checkbox" checked={defaultCategories.includes(category)} onChange={() => toggleCategory(category)} /><span className="checkmark" /><span style={{ fontSize: '12px' }}>{category}</span></label>)}</div>
          </div>
          <label style={{ fontSize: '12px', fontWeight: '600' }}>Existing beatmaps<select className="input-text" value={duplicateMode} onChange={(event) => setDuplicateMode(event.target.value)} style={{ display: 'block', marginTop: '5px' }}><option value="skip">Skip existing requests</option><option value="update">Update existing request details</option></select></label>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}><button type="button" className="btn-secondary" onClick={() => setStep('source')} disabled={isBusy}>Back</button><button type="button" className="btn-primary" onClick={showPreview} disabled={isBusy || !hasRequiredMapping || defaultCategories.length === 0}>{isBusy ? 'Validating...' : 'Review import'}</button></div>
        </>}

        {step === 'preview' && preview && <>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12px' }}><span><strong>{preview.totalRows}</strong> rows found</span><span style={{ color: 'var(--req-completed)' }}><strong>{preview.validRows}</strong> ready</span><span style={{ color: preview.invalidRows.length ? 'var(--priority-high)' : 'var(--text-muted)' }}><strong>{preview.invalidRows.length}</strong> invalid</span></div>
          {preview.invalidRows.length > 0 && <div style={{ padding: '10px 12px', background: 'rgba(243, 156, 18, 0.1)', borderRadius: '8px', fontSize: '12px' }}>{preview.invalidRows.slice(0, 10).map(row => <div key={row.rowNumber}>Row {row.rowNumber}: {row.errors.join(' ')}</div>)}</div>}
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '8px' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}><thead><tr style={{ background: 'var(--bg-sidebar)', textAlign: 'left' }}><th style={{ padding: '10px' }}>Row</th><th style={{ padding: '10px' }}>Link / title</th><th style={{ padding: '10px' }}>Notes</th><th style={{ padding: '10px' }}>Validation</th></tr></thead><tbody>{preview.previewRows.map(row => <tr key={row.rowNumber} style={{ borderTop: '1px solid var(--border)' }}><td style={{ padding: '8px 10px' }}>{row.rowNumber}</td><td style={{ padding: '8px 10px' }}>{row.link || row.title || 'Manual request'}</td><td style={{ padding: '8px 10px', maxWidth: '260px' }}>{row.notes || '—'}</td><td style={{ padding: '8px 10px', color: row.errors.length ? 'var(--priority-high)' : 'var(--req-completed)' }}>{row.errors.join(' ') || 'Ready'}</td></tr>)}</tbody></table></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}><button type="button" className="btn-secondary" onClick={() => setStep('mapping')} disabled={isBusy}>Back to mapping</button><button type="button" className="btn-primary" onClick={importRows} disabled={isBusy || preview.validRows === 0}>{isBusy ? 'Importing...' : `Import ${preview.validRows} requests`}</button></div>
        </>}

        {step === 'result' && result && <>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '14px', borderRadius: '8px', background: 'rgba(46, 204, 113, 0.1)' }}><CheckCircle size={18} style={{ color: 'var(--req-completed)' }} /><strong>Import complete</strong></div>
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '12px' }}><span>Imported: <strong>{result.imported}</strong></span><span>Updated: <strong>{result.updated}</strong></span><span>Metadata queued: <strong>{result.metadataQueued}</strong></span><span>Metadata ready: <strong>{result.metadataAlreadyAvailable}</strong></span><span>Metadata failed: <strong>{result.metadataFailed}</strong></span><span>Skipped: <strong>{result.skippedDuplicates}</strong></span><span>API failures: <strong>{result.apiFailures}</strong></span><span>Missing maps: <strong>{result.missingBeatmaps}</strong></span><span>Invalid: <strong>{result.invalid}</strong></span></div>
          {result.metadataQueued > 0 && <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Requests are available now. Full metadata and difficulty lists will appear as background synchronization completes.</p>}
          {result.errors.length > 0 && <div style={{ maxHeight: '180px', overflow: 'auto', padding: '10px 12px', background: 'var(--bg-sidebar)', borderRadius: '8px', fontSize: '12px' }}>{result.errors.map((entry, index) => <div key={`${entry.rowNumber}-${index}`}>Row {entry.rowNumber}: {entry.error}</div>)}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>{result.errors.length > 0 && <button type="button" className="btn-secondary" onClick={downloadErrors}>Download Error CSV</button>}<button type="button" className="btn-primary" onClick={onClose}>Close</button></div>
        </>}
      </section>
    </div>
  );
}
