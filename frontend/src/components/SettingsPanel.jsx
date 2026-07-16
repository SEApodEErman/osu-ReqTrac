import React, { useState, useEffect, useCallback } from 'react';
import { 
  Key, 
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

const IMPORT_CATEGORY_NAMES = ['Hitsounds', 'Guest Difficulties', 'Storyboards', 'Others'];
const APP_VERSION = '2.1.1';

export default function SettingsPanel({ 
  settingsData, 
  theme,
  onThemeChange,
  onSaveCredentials, 
  onDisconnect, 
  onImportBeatmapLinks,
  onImportJson,
  showFirstLaunchSetup = false,
  onDismissFirstLaunchSetup
}) {
  const { isConfigured, connectedAccount, userId } = settingsData || {};
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

  useEffect(() => {
    setConnectedUserId(userId || '');
  }, [userId]);

  // Local state for credentials config
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [connectedUserId, setConnectedUserId] = useState('');
  const [isSavingCreds, setIsSavingCreds] = useState(false);

  // Beatmap link import state
  const [linksText, setLinksText] = useState('');
  const [isImportingLinks, setIsImportingLinks] = useState(false);
  const [importCategories, setImportCategories] = useState({
    Hitsounds: true,
    'Guest Difficulties': false,
    Storyboards: false,
    Others: false
  });

  // Refresh added dates state
  const [isRefreshingDates, setIsRefreshingDates] = useState(false);

  // Google Sheets publishing state
  const [googleStatus, setGoogleStatus] = useState(null);
  const [isGoogleBusy, setIsGoogleBusy] = useState(false);

  const loadGoogleStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/google/status');
      if (res.ok) setGoogleStatus(await res.json());
    } catch (e) {
      console.error('Failed to load Google Sheets status:', e);
    }
  }, []);

  useEffect(() => {
    void loadGoogleStatus();
  }, [loadGoogleStatus]);

  useEffect(() => {
    const refreshWhenFocused = () => {
      void loadGoogleStatus();
    };
    window.addEventListener('focus', refreshWhenFocused);
    return () => window.removeEventListener('focus', refreshWhenFocused);
  }, [loadGoogleStatus]);

  const connectGoogle = async () => {
    setIsGoogleBusy(true);
    try {
      const res = await fetch('/api/google/auth-url');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Google Sheets is not configured.');
      if (window.electronAPI?.openExternal) {
        await window.electronAPI.openExternal(data.url);
      } else {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      }
      alert('Complete Google authorization in your browser, then return to ReqTrac and refresh this page.');
    } catch (e) {
      alert(e.message);
    } finally {
      setIsGoogleBusy(false);
    }
  };

  const syncGoogle = async () => {
    setIsGoogleBusy(true);
    try {
      const resolvedTheme = theme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : theme;
      const res = await fetch('/api/google/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: resolvedTheme })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Google Sheets sync failed.');
      setGoogleStatus((current) => ({ ...current, connected: true, sheetUrl: data.url, syncedAt: data.syncedAt }));
      alert('Google Sheet updated and set to read-only link sharing.');
    } catch (e) {
      alert(e.message);
    } finally {
      setIsGoogleBusy(false);
    }
  };

  const disconnectGoogle = async () => {
    if (!confirm('Disconnect Google Sheets? The existing sheet will remain in your Drive.')) return;
    setIsGoogleBusy(true);
    try {
      const res = await fetch('/api/google/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to disconnect Google Sheets.');
      setGoogleStatus((current) => ({ ...current, connected: false, sheetUrl: null, syncedAt: null }));
    } catch (e) {
      alert(e.message);
    } finally {
      setIsGoogleBusy(false);
    }
  };

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
    if (!clientId.trim() && !clientSecret.trim() && connectedUserId === (userId || '')) return;

    setIsSavingCreds(true);
    try {
      await onSaveCredentials({ 
        client_id: clientId.trim() || undefined, 
        client_secret: clientSecret.trim() || undefined,
        user_id: connectedUserId.trim()
      });
      setClientId('');
      setClientSecret('');
      setConnectedUserId('');
      alert('osu! API settings saved successfully.');
      setTimeout(validateOauthConfig, 500);
    } catch (e) {
      console.error(e);
      alert('Failed to save credentials.');
    } finally {
      setIsSavingCreds(false);
    }
  };

  const handleBeatmapLinksImport = async (e) => {
    e.preventDefault();
    if (!linksText.trim()) return;

    const selectedCategories = IMPORT_CATEGORY_NAMES.filter((category) => importCategories[category]);
    if (selectedCategories.length === 0) {
      alert('Please select at least one request category.');
      return;
    }

    setIsImportingLinks(true);
    try {
      const success = await onImportBeatmapLinks(linksText, selectedCategories);
      if (success) {
        setLinksText('');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsImportingLinks(false);
    }
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
            Manage your osu! API integration, import beatmap links, or backup/restore requests database.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {showFirstLaunchSetup && !isConfigured && (
          <div className="card" style={{ border: '1px solid var(--osu-pink)', backgroundColor: 'var(--osu-pink-transparent)' }}>
            <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>Welcome to osu!ReqTrac</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Add your osu! OAuth application Client ID and Client Secret below to enable beatmap syncing. You can optionally add your osu! User ID so guest difficulty requests can be matched to your profile without signing in.
            </p>
            <button type="button" className="btn-secondary" onClick={onDismissFirstLaunchSetup}>Got it</button>
          </div>
        )}
        
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Key size={18} style={{ color: 'var(--osu-pink)' }} />
            osu! API v2 Connection
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Configure your OAuth Application Client ID and Client Secret to sync beatmap and requester profiles. An osu! User ID is optional and is only used to identify your own guest difficulties. Get the credentials on the <a href="https://osu.ppy.sh/home/account/edit#oauth-applications" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--osu-pink)', textDecoration: 'underline' }}>osu! OAuth Application setup page</a>.
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
                <span>{oauthValidation.valid ? 'API Configuration Valid' : 'API Configuration Issues Detected'}</span>
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
                <span>User ID: {userId || 'Not set'}</span>
              </div>
              {!oauthValidation.valid && (
                <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)' }}>
                  Configure your OAuth application at <a href="https://osu.ppy.sh/home/account/edit#oauth-applications" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--osu-pink)' }}>osu! OAuth settings</a>.
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
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Your osu! User ID (Optional)</label>
              <input
                type="text"
                inputMode="numeric"
                className="input-text"
                placeholder={userId || 'e.g. 2'}
                value={connectedUserId}
                onChange={(e) => setConnectedUserId(e.target.value)}
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
            <FileSpreadsheet size={18} style={{ color: 'var(--req-completed)' }} />
            Public Google Sheet
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Create a formatted, read-only copy of your request table in your Google Drive. You can put the resulting link on your osu! profile.
          </p>

          {!googleStatus?.configured && (
            <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(243, 156, 18, 0.1)', color: 'var(--text-muted)', fontSize: '12px' }}>
              Google Sheets export needs a Google OAuth desktop application configured by the app maintainer. See the setup notes in the project README.
            </div>
          )}

          {googleStatus?.connected && googleStatus.sheetUrl && (
            <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(46, 204, 113, 0.1)', border: '1px solid rgba(46, 204, 113, 0.3)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: '600' }}>Published sheet</span>
              <a href={googleStatus.sheetUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--osu-pink)', fontSize: '12px', wordBreak: 'break-all' }}>{googleStatus.sheetUrl}</a>
              {googleStatus.syncedAt && <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Last synced: {new Date(googleStatus.syncedAt).toLocaleString()}</span>}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {!googleStatus?.connected ? (
              <button type="button" className="btn-primary" onClick={connectGoogle} disabled={isGoogleBusy || !googleStatus?.configured}>
                {isGoogleBusy ? 'Opening...' : 'Connect Google Drive'}
              </button>
            ) : (
              <>
                <button type="button" className="btn-primary" onClick={syncGoogle} disabled={isGoogleBusy}>
                  {isGoogleBusy ? 'Syncing...' : googleStatus.sheetUrl ? 'Sync Sheet' : 'Publish Sheet'}
                </button>
                <button type="button" className="btn-secondary" onClick={disconnectGoogle} disabled={isGoogleBusy}>Disconnect</button>
              </>
            )}
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileSpreadsheet size={18} style={{ color: 'var(--req-working)' }} />
            Import Beatmap Links
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Paste one osu! beatmap link per line to import multiple requests at once. Imported requests intentionally have no added date.
          </p>

          <form onSubmit={handleBeatmapLinksImport} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>
                Paste beatmap links (one per line)
              </label>
              <textarea 
                className="input-text" 
                placeholder={'https://osu.ppy.sh/beatmapsets/123456\nhttps://osu.ppy.sh/beatmaps/789012'}
                value={linksText}
                onChange={(e) => setLinksText(e.target.value)}
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
            <div>
              <button type="submit" className="btn-primary" disabled={isImportingLinks || !linksText.trim()}>
                {isImportingLinks ? 'Importing & Syncing...' : 'Import Requests'}
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
            Choose a color theme, or follow your operating system preference. The setting is saved locally in your browser.
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
              onClick={() => onThemeChange('dark')}
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
              onClick={() => onThemeChange('light')}
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
            <button
              onClick={() => onThemeChange('system')}
              style={{
                flexGrow: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '10px 20px',
                borderRadius: '6px',
                backgroundColor: theme === 'system' ? 'var(--bg-card)' : 'transparent',
                color: theme === 'system' ? 'var(--osu-pink)' : 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontSize: '12px',
                fontWeight: '600'
              }}
            >
              <Monitor size={14} style={{ marginRight: '6px' }} />
              <span>System</span>
            </button>
          </div>
        </div>

      </div>

      <footer style={{
        borderTop: '1px solid var(--border)',
        paddingTop: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        color: 'var(--text-muted)',
        fontSize: '11px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span>osu!ReqTrac v{APP_VERSION}</span>
          <span aria-hidden="true">|</span>
          <a
            href="https://github.com/seapodeerman/osu-ReqTrac"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--osu-pink)', textDecoration: 'underline' }}
          >
            GitHub repository
          </a>
        </div>
        <span>osu! and related marks are trademarks of ppy Pty Ltd. This project is not affiliated with or endorsed by ppy Pty Ltd.</span>
      </footer>

    </div>
  );
}
