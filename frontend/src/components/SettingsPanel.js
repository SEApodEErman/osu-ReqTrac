'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Key, 
  UserCheck, 
  Upload, 
  Download, 
  FileSpreadsheet, 
  FileJson, 
  LogOut,
  Moon,
  Sun,
  Monitor,
  AlertCircle,
  CheckCircle,
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
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark';
    return localStorage.getItem('theme') || 'dark';
  });
  const [oauthValidation, setOauthValidation] = useState(null);
  const [isValidatingOauth, setIsValidatingOauth] = useState(false);

  const validateOauthConfig = useCallback(async () => {
    if (!isConfigured) {
      setOauthValidation({ valid: false, issues: ['Client ID and Client Secret not configured'], clientIdConfigured: false, clientSecretConfigured: false, redirectUri: '' });
      return;
    }
    setIsValidatingOauth(true);
    try {
      const res = await fetch('/api/settings/oauth-validate');
      if (res.ok) {
        const data = await res.json();
        setOauthValidation(data);
      }
    } catch (e) {
      console.error('OAuth validation failed:', e);
    } finally {
      setIsValidatingOauth(false);
    }
  }, [isConfigured]);

  // Validate OAuth config on mount and when credentials change.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void validateOauthConfig();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [validateOauthConfig]);

  const toggleTheme = (newTheme) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  // Local state for credentials config
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [isSavingCreds, setIsSavingCreds] = useState(false);

  // CSV State
  const [csvText, setCsvText] = useState('');
  const [isImportingCsv, setIsImportingCsv] = useState(false);

  // Refresh added dates state
  const [isRefreshingDates, setIsRefreshingDates] = useState(false);

  const handleRefreshDates = async () => {
    const confirmRefresh = confirm('This will overwrite the "Date Added" of all osu! link requests with each map\'s upload date from osu!. Continue?');
    if (!confirmRefresh) return;

    setIsRefreshingDates(true);
    try {
      const res = await fetch('/api/requests/refresh-dates', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
      } else {
        alert(`Failed to refresh dates: ${data.error || 'Server Error'}`);
      }
    } catch (e) {
      console.error(e);
      alert('Network error while refreshing dates.');
    } finally {
      setIsRefreshingDates(false);
    }
  };

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
      setTimeout(validateOauthConfig, 500);
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
            e.target.reset();
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
      
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: '700', fontFamily: 'var(--font-display)', marginBottom: '4px' }}>
          Settings
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
          Manage your osu! API integration, import data from spreadsheets, or backup/restore requests database.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Key size={18} style={{ color: 'var(--osu-pink)' }} />
            osu! API v2 Connection
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            To automatically sync beatmap and requester profiles, you must configure your OAuth Application credentials. Get them on the <a href="https://osu.ppy.sh/home/account/edit#oauth-applications" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--osu-pink)', textDecoration: 'underline' }}>osu! OAuth Application setup page</a>.
          </p>

          {oauthValidation && (
            <div style={{
              padding: '12px 16px',
              borderRadius: '8px',
              border: `1px solid ${oauthValidation.valid ? 'var(--req-completed)' : 'var(--priority-medium)'}`,
              backgroundColor: oauthValidation.valid ? 'rgba(46, 204, 113, 0.1)' : 'rgba(243, 156, 18, 0.1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              fontSize: '12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600' }}>
                {oauthValidation.valid ? (
                  <CheckCircle size={16} style={{ color: 'var(--req-completed)' }} />
                ) : (
                  <AlertCircle size={16} style={{ color: 'var(--priority-medium)' }} />
                )}
                <span>{oauthValidation.valid ? 'OAuth Configuration Valid' : 'OAuth Configuration Issues Detected'}</span>
                {isValidatingOauth && <RefreshCw size={14} className="spin" style={{ color: 'var(--osu-pink)', marginLeft: 'auto' }} />}
              </div>
              {oauthValidation.issues && oauthValidation.issues.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-muted)' }}>
                  {oauthValidation.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              )}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--text-muted)' }}>
                <span>Client ID: {oauthValidation.clientIdConfigured ? '✓' : '✗'}</span>
                <span>Client Secret: {oauthValidation.clientSecretConfigured ? '✓' : '✗'}</span>
                <span>Redirect URI: {oauthValidation.redirectUri || 'Not set'}</span>
              </div>
              {!oauthValidation.valid && (
                <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)' }}>
                  Configure your OAuth application at <a href="https://osu.ppy.sh/home/account/edit#oauth-applications" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--osu-pink)' }}>osu! OAuth settings</a>. 
                  Make sure the Redirect URI is set to <code>{oauthValidation.redirectUri || 'http://localhost:3001/api/settings/oauth-callback'}</code>.
                </p>
              )}
            </div>
          )}

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
                placeholder={isConfigured ? '********' : 'Enter Client Secret...'} 
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button type="submit" className="btn-primary" disabled={isSavingCreds}>
                {isSavingCreds ? 'Saving...' : 'Save Credentials'}
              </button>

              <button 
                type="button" 
                onClick={handleConnectOsu} 
                className="btn-secondary"
                disabled={!isConfigured}
                style={{ 
                  color: connectedAccount ? 'var(--req-completed)' : (isConfigured ? 'var(--text-main)' : 'var(--text-muted)'),
                  borderColor: connectedAccount ? 'var(--req-completed)' : (isConfigured ? 'var(--border)' : 'var(--border)'),
                  opacity: isConfigured ? 1 : 0.6,
                  cursor: isConfigured ? 'pointer' : 'not-allowed'
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

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileSpreadsheet size={18} style={{ color: 'var(--req-working)' }} />
            Google Sheets CSV Migration
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Migrate from your existing requests spreadsheet. The CSV must have column headers: <code>Artist, Title, Mapper, Link, Map Status, Remarks</code>. 
            Links in the Link column will trigger automatic metadata fetching from osu!.
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

          <div style={{ height: '1px', backgroundColor: 'var(--border)', margin: '4px 0' }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <h4 style={{ fontSize: '13px', fontWeight: '600' }}>Refresh Added Dates</h4>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Set the &quot;Date Added&quot; of each osu! link request to the map&apos;s actual upload date from osu!. Useful after importing from a spreadsheet. Runs in the background and may take a while due to API rate limiting.
            </p>
            <button 
              type="button" 
              onClick={handleRefreshDates} 
              className="btn-secondary" 
              disabled={isRefreshingDates}
              style={{ width: 'fit-content' }}
            >
              <RefreshCw size={14} className={isRefreshingDates ? 'spin' : ''} />
              <span>{isRefreshingDates ? 'Starting...' : 'Refresh Added Dates from osu!'}</span>
            </button>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileJson size={18} style={{ color: '#cca000' }} />
            Database Backup & Restore
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Export all requests, tags, history logs, settings, and cached metadata to a consolidated backup file, or restore from a previously exported <code>backup.json</code> file.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            
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

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Monitor size={18} style={{ color: 'var(--osu-pink)' }} />
            Appearance
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Choose your preferred color theme. The setting is saved locally in your browser.
          </p>

          <div style={{ 
            display: 'flex', 
            backgroundColor: 'var(--bg-app)', 
            borderRadius: '8px', 
            padding: '2px',
            border: '1px solid var(--border)',
            width: 'fit-content'
          }}>
            <button
              onClick={() => toggleTheme('dark')}
              style={{
                flexGrow: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '10px 20px',
                borderRadius: '6px',
                backgroundColor: theme === 'dark' ? 'var(--bg-card)' : 'transparent',
                color: theme === 'dark' ? 'var(--osu-pink)' : 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontSize: '12px',
                fontWeight: '600'
              }}
            >
              <Moon size={14} style={{ marginRight: '6px' }} />
              <span>Dark</span>
            </button>
            <button
              onClick={() => toggleTheme('light')}
              style={{
                flexGrow: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '10px 20px',
                borderRadius: '6px',
                backgroundColor: theme === 'light' ? 'var(--bg-card)' : 'transparent',
                color: theme === 'light' ? 'var(--osu-pink)' : 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontSize: '12px',
                fontWeight: '600'
              }}
            >
              <Sun size={14} style={{ marginRight: '6px' }} />
              <span>Light</span>
            </button>
          </div>
        </div>

      </div>

    </div>
  );
}
