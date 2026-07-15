'use client';

import React, { useState } from 'react';
import { 
  Settings, 
  Key, 
  UserCheck, 
  Upload, 
  Download, 
  FileSpreadsheet, 
  FileJson, 
  LogOut,
  RefreshCw
} from 'lucide-react';

export default function SettingsPanel({ 
  settingsData, 
  onSaveCredentials, 
  onDisconnect, 
  onImportCsv,
  onImportJson
}) {
  const { isConfigured, connectedAccount } = settingsData || {};

  // Local state for credentials config
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [isSavingCreds, setIsSavingCreds] = useState(false);

  // CSV State
  const [csvText, setCsvText] = useState('');
  const [isImportingCsv, setIsImportingCsv] = useState(false);

  // JSON Backup upload state
  const [jsonFile, setJsonFile] = useState(null);
  const [isRestoringJson, setIsRestoringJson] = useState(false);

  const handleSaveCredentials = async (e) => {
    e.preventDefault();
    if (!clientId.trim() && !clientSecret.trim()) return;

    setIsSavingCreds(true);
    try {
      await onSaveCredentials({ 
        client_id: clientId.trim() || undefined, 
        client_secret: clientSecret.trim() || undefined 
      });
      setClientId('');
      setClientSecret('');
      alert('osu! API credentials saved successfully.');
    } catch (e) {
      console.error(e);
      alert('Failed to save credentials.');
    } finally {
      setIsSavingCreds(false);
    }
  };

  const handleConnectOsu = async () => {
    try {
      const res = await fetch('/api/settings/oauth-url');
      if (res.ok) {
        const data = await res.json();
        // Redirect browser to osu! auth
        window.location.href = data.url;
      } else {
        const err = await res.json();
        alert(`Error: ${err.error || 'Please configure Client ID and Secret first.'}`);
      }
    } catch (e) {
      console.error(e);
      alert('OAuth initialization failed.');
    }
  };

  const handleCsvImport = async (e) => {
    e.preventDefault();
    if (!csvText.trim()) return;

    setIsImportingCsv(true);
    try {
      const success = await onImportCsv(csvText);
      if (success) {
        setCsvText('');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsImportingCsv(false);
    }
  };

  const handleCsvFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setCsvText(event.target.result);
    };
    reader.readAsText(file);
  };

  const handleJsonRestore = async (e) => {
    e.preventDefault();
    if (!jsonFile) return;

    const confirmRestore = confirm('WARNING: Importing backup data will overwrite all existing requests, categories, and settings. Proceed?');
    if (!confirmRestore) return;

    setIsRestoringJson(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const backupObj = JSON.parse(event.target.result);
          const success = await onImportJson(backupObj);
          if (success) {
            setJsonFile(null);
            e.target.reset(); // reset file input
          }
        } catch (err) {
          alert('Invalid backup JSON structure. Make sure you upload a valid backup.json file.');
        }
      };
      reader.readAsText(jsonFile);
    } catch (e) {
      console.error(e);
    } finally {
      setIsRestoringJson(false);
    }
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
      
      {/* Settings Header */}
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: '700', fontFamily: 'var(--font-display)', marginBottom: '4px' }}>
          Settings
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
          Manage your osu! API integration, import data from spreadsheets, or backup/restore requests database.
        </p>
      </div>

      {/* Grid of panels */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* Panel 1: osu! API Credentials Setup */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Key size={18} style={{ color: 'var(--osu-pink)' }} />
            osu! API v2 Connection
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            To automatically sync beatmap and requester profiles, you must configure your OAuth Application credentials. Get them on the <a href="https://osu.ppy.sh/home/account/edit#oauth-applications" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--osu-pink)', textDecoration: 'underline' }}>osu! OAuth Application setup page</a>.
          </p>

          <form onSubmit={handleSaveCredentials} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Client ID</label>
              <input 
                type="text" 
                className="input-text" 
                placeholder={isConfigured ? '********' : 'Enter Client ID...'} 
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Client Secret</label>
              <input 
                type="password" 
                className="input-text" 
                placeholder={isConfigured ? '••••••••••••••••' : 'Enter Client Secret...'} 
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button type="submit" className="btn-primary" disabled={isSavingCreds}>
                {isSavingCreds ? 'Saving...' : 'Save Credentials'}
              </button>

              {/* Connect Account OAuth (Trigger only if credentials saved/configured) */}
              <button 
                type="button" 
                onClick={handleConnectOsu} 
                className="btn-secondary"
                style={{ 
                  color: connectedAccount ? 'var(--req-completed)' : 'var(--text-main)',
                  borderColor: connectedAccount ? 'var(--req-completed)' : 'var(--border)'
                }}
              >
                <UserCheck size={16} />
                <span>{connectedAccount ? `Connected: ${connectedAccount.username}` : 'Connect osu! Account'}</span>
              </button>

              {connectedAccount && (
                <button 
                  type="button" 
                  onClick={onDisconnect} 
                  className="btn-secondary"
                  style={{ color: 'var(--priority-high)', borderColor: 'rgba(231, 76, 60, 0.3)' }}
                >
                  <LogOut size={16} />
                  <span>Disconnect</span>
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Panel 2: Google Sheets CSV Migration */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileSpreadsheet size={18} style={{ color: 'var(--req-working)' }} />
            Google Sheets CSV Migration
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Migrate from your existing requests spreadsheet. The CSV must have column headers (e.g. <i>Artist, Title, Creator, Link, Requester, Status, Priority, Deadline, Notes, Tags, Categories</i>). Pasting links inside the Link column will trigger metadata fetching.
          </p>

          <form onSubmit={handleCsvImport} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>
                Paste CSV Contents or Select File
              </label>
              <input 
                type="file" 
                accept=".csv" 
                onChange={handleCsvFileChange}
                style={{ fontSize: '12px', marginBottom: '8px', color: 'var(--text-muted)' }}
              />
              <textarea 
                className="input-text" 
                placeholder="Paste CSV rows here (comma-separated)..."
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                style={{ minHeight: '120px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
              />
            </div>
            <div>
              <button type="submit" className="btn-primary" disabled={isImportingCsv || !csvText.trim()}>
                {isImportingCsv ? 'Importing & Syncing...' : 'Migrate Requests'}
              </button>
            </div>
          </form>
        </div>

        {/* Panel 3: Data Backup (JSON Export / Import) */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileJson size={18} style={{ color: '#cca000' }} />
            Database Backup & Restore
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Export all requests, tags, history logs, settings, and cached metadata to a consolidated backup file, or restore from a previously exported <code>backup.json</code> file.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            
            {/* Export Section */}
            <div style={{ padding: '16px', backgroundColor: 'var(--bg-sidebar)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '12px', justifyContent: 'space-between' }}>
              <div>
                <h4 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>Export Backup</h4>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Download your entire database as a backup.json file.</p>
              </div>
              <a 
                href="/api/migration/export" 
                download="backup.json"
                className="btn-primary" 
                style={{ width: 'fit-content', justifyContent: 'center' }}
              >
                <Download size={16} />
                <span>Download backup.json</span>
              </a>
            </div>

            {/* Import / Restore Section */}
            <div style={{ padding: '16px', backgroundColor: 'var(--bg-sidebar)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '12px', justifyContent: 'space-between' }}>
              <div>
                <h4 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>Restore Backup</h4>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Select a backup.json file to restore. Overwrites current data.</p>
              </div>
              
              <form onSubmit={handleJsonRestore} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <input 
                  type="file" 
                  accept=".json" 
                  onChange={(e) => setJsonFile(e.target.files[0])}
                  style={{ fontSize: '11px', color: 'var(--text-muted)' }}
                />
                <button 
                  type="submit" 
                  className="btn-secondary" 
                  disabled={isRestoringJson || !jsonFile}
                  style={{ 
                    width: 'fit-content', 
                    color: jsonFile ? 'var(--priority-high)' : 'var(--text-muted)',
                    borderColor: jsonFile ? 'rgba(231, 76, 60, 0.4)' : 'var(--border)'
                  }}
                >
                  <Upload size={14} />
                  <span>{isRestoringJson ? 'Restoring...' : 'Upload & Restore'}</span>
                </button>
              </form>
            </div>

          </div>
        </div>

      </div>

    </div>
  );
}
