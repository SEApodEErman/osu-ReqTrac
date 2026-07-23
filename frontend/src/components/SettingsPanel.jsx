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
  HardDrive,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Trash2
} from 'lucide-react';
import SpreadsheetImportModal from './SpreadsheetImportModal';

const APP_VERSION = '1.3.1';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unitIndex);
  const fractionDigits = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

export default function SettingsPanel({ 
  settingsData, 
  theme,
  onThemeChange,
  onSaveCredentials,
  onDisconnect,
  onDeleteAllData,
  onImportJson,
  onSpreadsheetImported = async () => {},
  onNotify = () => {},
  onRequestConfirmation = async () => false,
  categoryDefinitions = [],
  onCategoriesChanged = async () => {},
  showFirstLaunchSetup = false,
  onDismissFirstLaunchSetup
}) {
  const { isConfigured, connectedAccount, userId } = settingsData || {};
  const [oauthValidation, setOauthValidation] = useState(null);
  const [isValidatingOauth, setIsValidatingOauth] = useState(false);
  const [allCategories, setAllCategories] = useState(categoryDefinitions);
  const [newCategoryName, setNewCategoryName] = useState('');

  const refreshCategories = useCallback(async () => {
    const response = await fetch('/api/categories?includeArchived=1');
    if (response.ok) setAllCategories(await response.json());
  }, []);

  useEffect(() => { void refreshCategories(); }, [refreshCategories]);

  const updateCategory = async (category, updates) => {
    const response = await fetch(`/api/categories/${category.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const result = await response.json();
    if (!response.ok) return onNotify(result.error || 'Failed to update category.', 'error');
    await Promise.all([refreshCategories(), onCategoriesChanged()]);
  };

  const createCategory = async (event) => {
    event.preventDefault();
    const response = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newCategoryName }),
    });
    const result = await response.json();
    if (!response.ok) return onNotify(result.error || 'Failed to create category.', 'error');
    setNewCategoryName('');
    await Promise.all([refreshCategories(), onCategoriesChanged()]);
    onNotify(`Created category “${result.name}”.`, 'success');
  };

  const moveCategory = async (category, direction) => {
    const active = allCategories.filter(item => item.is_active).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const index = active.findIndex(item => item.id === category.id);
    const swap = active[index + direction];
    if (!swap) return;
    await updateCategory(category, { sort_order: swap.sort_order });
    await updateCategory(swap, { sort_order: category.sort_order });
  };

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

  // Refresh request dates state
  const [isRefreshingDates, setIsRefreshingDates] = useState(false);
  const [isSpreadsheetImportOpen, setIsSpreadsheetImportOpen] = useState(false);
  const [metadataSyncStatus, setMetadataSyncStatus] = useState(null);
  const [isRetryingMetadata, setIsRetryingMetadata] = useState(false);
  const [failedMetadata, setFailedMetadata] = useState([]);
  const [isFailedMetadataVisible, setIsFailedMetadataVisible] = useState(false);
  const [isLoadingFailedMetadata, setIsLoadingFailedMetadata] = useState(false);
  const [coverStorageUsage, setCoverStorageUsage] = useState(null);
  const [coverStorageError, setCoverStorageError] = useState(false);

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

  const loadMetadataSyncStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/beatmaps/sync/status');
      if (res.ok) setMetadataSyncStatus(await res.json());
    } catch (e) {
      console.error('Failed to load metadata sync status:', e);
    }
  }, []);

  const loadFailedMetadata = useCallback(async () => {
    setIsLoadingFailedMetadata(true);
    try {
      const res = await fetch('/api/beatmaps/sync/failed');
      if (!res.ok) throw new Error('Could not load failed metadata details.');
      setFailedMetadata(await res.json());
      setIsFailedMetadataVisible(true);
    } catch (error) {
      onNotify(error.message, 'error');
    } finally {
      setIsLoadingFailedMetadata(false);
    }
  }, [onNotify]);

  const loadDataUsage = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/data-usage');
      if (!res.ok) throw new Error('Failed to load data usage.');
      setCoverStorageUsage(await res.json());
      setCoverStorageError(false);
    } catch (e) {
      console.error('Failed to load data usage:', e);
      setCoverStorageError(true);
    }
  }, []);

  useEffect(() => {
    void loadGoogleStatus();
    void loadMetadataSyncStatus();
    void loadDataUsage();
  }, [loadDataUsage, loadGoogleStatus, loadMetadataSyncStatus]);

  const hasActiveMetadataSync = (metadataSyncStatus?.Pending || 0) + (metadataSyncStatus?.Processing || 0) > 0;
  useEffect(() => {
    if (!hasActiveMetadataSync) return undefined;
    const intervalId = window.setInterval(() => void loadMetadataSyncStatus(), 3000);
    return () => window.clearInterval(intervalId);
  }, [hasActiveMetadataSync, loadMetadataSyncStatus]);

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
      onNotify('Complete Google authorization in your browser, then return to ReqTrac and refresh this page.', 'info');
    } catch (e) {
      onNotify(e.message, 'error');
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
      onNotify('Google Sheet updated and set to read-only link sharing.', 'success');
    } catch (e) {
      onNotify(e.message, 'error');
    } finally {
      setIsGoogleBusy(false);
    }
  };

  const disconnectGoogle = async () => {
    const confirmed = await onRequestConfirmation({
      title: 'Disconnect Google Sheets?',
      message: 'The existing sheet will remain in your Drive, but ReqTrac will no longer be connected to it.',
      confirmLabel: 'Disconnect',
    });
    if (!confirmed) return;
    setIsGoogleBusy(true);
    try {
      const res = await fetch('/api/google/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to disconnect Google Sheets.');
      setGoogleStatus((current) => ({ ...current, connected: false, sheetUrl: null, syncedAt: null }));
    } catch (e) {
      onNotify(e.message, 'error');
    } finally {
      setIsGoogleBusy(false);
    }
  };

  const handleRefreshDates = async () => {
    const confirmed = await onRequestConfirmation({
      title: 'Overwrite request dates?',
      message: 'This will replace the "Date Added" of all osu! link requests with each map\'s ranked/loved date, or its last updated date when it is not Ranked or Loved.',
      confirmLabel: 'Refresh dates',
    });
    if (!confirmed) return;

    setIsRefreshingDates(true);
    try {
      const res = await fetch('/api/requests/refresh-dates', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        onNotify(data.message, 'success');
      } else {
        onNotify(`Failed to refresh dates: ${data.error || 'Server Error'}`, 'error');
      }
    } catch (e) {
      console.error(e);
      onNotify('Network error while refreshing dates.', 'error');
    } finally {
      setIsRefreshingDates(false);
    }
  };

  const retryFailedMetadata = async () => {
    setIsRetryingMetadata(true);
    try {
      const res = await fetch('/api/beatmaps/sync/retry', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to retry metadata synchronization.');
      onNotify(data.message, 'success');
      setFailedMetadata([]);
      setIsFailedMetadataVisible(false);
      await loadMetadataSyncStatus();
    } catch (e) {
      onNotify(e.message, 'error');
    } finally {
      setIsRetryingMetadata(false);
    }
  };

  // JSON Backup upload state
  const [jsonFile, setJsonFile] = useState(null);
  const [isRestoringJson, setIsRestoringJson] = useState(false);
  const [isDeletingAllData, setIsDeletingAllData] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');

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
      onNotify('osu! API settings saved successfully.', 'success');
      setTimeout(validateOauthConfig, 500);
    } catch (e) {
      console.error(e);
      onNotify('Failed to save credentials.', 'error');
    } finally {
      setIsSavingCreds(false);
    }
  };

  const handleJsonRestore = async (e) => {
    e.preventDefault();
    if (!jsonFile) return;

    const confirmed = await onRequestConfirmation({
      title: 'Restore backup and replace existing data?',
      message: 'Importing this backup will replace all existing requests, categories, metadata, settings, and cached data. Backups may contain osu! and Google credentials, so only restore a trusted private backup.',
      confirmLabel: 'Restore backup',
    });
    if (!confirmed) return;

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
          onNotify('Invalid backup JSON structure. Make sure you upload a valid backup.json file.', 'error');
        }
      };
      reader.readAsText(jsonFile);
    } catch (e) {
      console.error(e);
    } finally {
      setIsRestoringJson(false);
    }
  };

  const openDeleteConfirmation = () => {
    if (isDeletingAllData) return;
    setDeleteConfirmationText('');
    setIsDeleteConfirmOpen(true);
  };

  const cancelDeleteConfirmation = () => {
    if (isDeletingAllData) return;
    setDeleteConfirmationText('');
    setIsDeleteConfirmOpen(false);
  };

  const handleDeleteAllData = async (event) => {
    event.preventDefault();
    if (isDeletingAllData || deleteConfirmationText !== 'DELETE') return;

    setIsDeletingAllData(true);
    try {
      await onDeleteAllData();
      await loadDataUsage();
      setIsDeleteConfirmOpen(false);
      setDeleteConfirmationText('');
      onNotify('All local application data was deleted.', 'success');
    } catch (error) {
      console.error(error);
      onNotify(error.message || 'Failed to delete all application data.', 'error');
    } finally {
      setIsDeletingAllData(false);
    }
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
      
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: '700', fontFamily: 'var(--font-display)', marginBottom: '4px' }}>
          Settings
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
          Manage your osu! API integration or backup/restore your requests database.
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

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '4px' }}>Request Categories</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Create, rename, reorder, or archive categories. Built-in category behavior follows its internal type even if you rename it.
            </p>
          </div>
          <form onSubmit={createCategory} style={{ display: 'flex', gap: '8px' }}>
            <input className="input-text" value={newCategoryName} onChange={event => setNewCategoryName(event.target.value)} placeholder="New category name" maxLength={80} />
            <button type="submit" className="btn-primary" disabled={!newCategoryName.trim()}>Create</button>
          </form>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {[...allCategories].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id).map(category => (
              <div key={category.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) auto 86px', gap: '7px', alignItems: 'center', padding: '8px', border: '1px solid var(--border)', borderRadius: '7px', opacity: category.is_active ? 1 : 0.65 }}>
                <form onSubmit={event => {
                  event.preventDefault();
                  const name = new FormData(event.currentTarget).get('name');
                  void updateCategory(category, { name });
                }} style={{ display: 'flex', gap: '6px', minWidth: 0 }}>
                  <input name="name" className="input-text" defaultValue={category.name} key={`${category.id}:${category.name}`} disabled={!category.is_active} style={{ padding: '5px 8px' }} />
                  <button type="submit" className="btn-secondary" disabled={!category.is_active} style={{ padding: '5px 8px' }}>Save</button>
                </form>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button type="button" className="btn-secondary" disabled={!category.is_active} onClick={() => void moveCategory(category, -1)} aria-label={`Move ${category.name} up`}>↑</button>
                  <button type="button" className="btn-secondary" disabled={!category.is_active} onClick={() => void moveCategory(category, 1)} aria-label={`Move ${category.name} down`}>↓</button>
                </div>
                {category.system_key ? (
                  <span style={{ fontSize: '15px', fontWeight: '500', color: 'var(--text-muted)', width: '100%', textAlign: 'center' }}>Built-in</span>
                ) : category.is_active ? (
                  <button type="button" className="btn-secondary" onClick={async () => {
                    const confirmed = await onRequestConfirmation({ title: `Archive ${category.name}?`, message: 'Existing requests keep this category, but it will be hidden from new selections.', confirmLabel: 'Archive' });
                    if (!confirmed) return;
                    const response = await fetch(`/api/categories/${category.id}`, { method: 'DELETE' });
                    const result = await response.json();
                    if (!response.ok) return onNotify(result.error || 'Failed to archive category.', 'error');
                    await Promise.all([refreshCategories(), onCategoriesChanged()]);
                  }} style={{ width: '100%', justifyContent: 'center' }}>Archive</button>
                ) : (
                  <button type="button" className="btn-secondary" onClick={() => void updateCategory(category, { is_active: true })} style={{ width: '100%', justifyContent: 'center' }}>Restore</button>
                )}
              </div>
            ))}
          </div>
        </div>
        
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

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', border: '1px solid rgba(231, 76, 60, 0.45)' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--priority-high)' }}>
            <Trash2 size={18} />
            Delete All Data
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Permanently remove all local requests, history, tags, cached osu! metadata, downloaded covers, credentials, and Google Sheets connection data. Google Sheets already published to Drive will remain there.
          </p>
          <button
            type="button"
            onClick={openDeleteConfirmation}
            className="btn-secondary"
            disabled={isDeletingAllData}
            style={{ width: 'fit-content', color: 'var(--priority-high)', borderColor: 'rgba(231, 76, 60, 0.5)' }}
          >
            <Trash2 size={14} />
            <span>{isDeletingAllData ? 'Deleting...' : 'Delete All Data'}</span>
          </button>
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

          {googleStatus?.configured && !googleStatus?.hasConnected && (
            <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(243, 156, 18, 0.1)', border: '1px solid rgba(243, 156, 18, 0.25)', color: 'var(--text-muted)', fontSize: '12px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <AlertCircle size={16} style={{ color: 'var(--priority-medium)', flexShrink: 0, marginTop: '1px' }} />
              <span>
                Google may show an “unverified app” warning during authorization. This is temporary while this new application completes Google’s verification process. Your export data is sent directly to your Google Sheet through the Google Sheets API and is never sent anywhere else.
              </span>
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

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileSpreadsheet size={18} style={{ color: 'var(--req-completed)' }} />
            Import Requests from Spreadsheet
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Migrate CSV, Excel, or public Google Sheets data while mapping columns such as remarks to request notes. You can review mappings and validation before importing.
          </p>
          {metadataSyncStatus && <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--text-muted)' }}>
            <span>Pending: <strong style={{ color: 'var(--text-main)' }}>{metadataSyncStatus.Pending}</strong></span>
            <span>Processing: <strong style={{ color: 'var(--text-main)' }}>{metadataSyncStatus.Processing}</strong></span>
            <span>Completed: <strong style={{ color: 'var(--text-main)' }}>{metadataSyncStatus.Completed}</strong></span>
            <span>Failed: <strong style={{ color: metadataSyncStatus.Failed ? 'var(--priority-high)' : 'var(--text-main)' }}>{metadataSyncStatus.Failed}</strong></span>
          </div>}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" className="btn-secondary" onClick={() => setIsSpreadsheetImportOpen(true)} style={{ width: 'fit-content' }}>
              <Upload size={14} />
              <span>Import Spreadsheet</span>
            </button>
            {(metadataSyncStatus?.Failed || 0) > 0 && <button type="button" className="btn-secondary" onClick={retryFailedMetadata} disabled={isRetryingMetadata} style={{ width: 'fit-content' }}>
              <RefreshCw size={14} className={isRetryingMetadata ? 'spin' : ''} />
              <span>{isRetryingMetadata ? 'Retrying...' : 'Retry Failed Metadata'}</span>
            </button>}
            {(metadataSyncStatus?.Failed || 0) > 0 && <button type="button" className="btn-secondary" onClick={() => isFailedMetadataVisible ? setIsFailedMetadataVisible(false) : loadFailedMetadata()} disabled={isLoadingFailedMetadata} style={{ width: 'fit-content' }}>
              <AlertCircle size={14} />
              <span>{isLoadingFailedMetadata ? 'Loading failures...' : isFailedMetadataVisible ? 'Hide Failure Details' : 'View Failure Details'}</span>
            </button>}
          </div>
          {isFailedMetadataVisible && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px', maxHeight: '280px', overflowY: 'auto' }}>
              <strong style={{ fontSize: '12px' }}>Failed metadata details</strong>
              {failedMetadata.length === 0 ? (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>No failed metadata entries remain.</span>
              ) : failedMetadata.map(item => (
                <div key={item.beatmapset_id} style={{ padding: '9px 10px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg-sidebar)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '11px' }}>
                    <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.artist && item.title ? `${item.artist} — ${item.title}` : `Beatmapset ${item.beatmapset_id}`}</strong>
                    <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>ID: {item.beatmapset_id} · {item.attempt_count} attempts</span>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--priority-high)', overflowWrap: 'anywhere' }}>{item.last_error || 'No error details were recorded.'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h4 style={{ fontSize: '13px', fontWeight: '600' }}>Refresh Added Dates</h4>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Set the &quot;Date Added&quot; of each osu! link request to the map&apos;s ranked/loved date, or its last updated date when it is not Ranked or Loved. Useful after importing from a spreadsheet. Runs in the background and may take a while due to API rate limiting.
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

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileJson size={18} style={{ color: '#cca000' }} />
            Database Backup & Restore
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Export all requests, tags, history logs, settings, and cached metadata to a consolidated backup file, or restore from a previously exported <code>backup.json</code> file.
          </p>
          <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid rgba(231, 76, 60, 0.4)', backgroundColor: 'rgba(231, 76, 60, 0.1)', color: 'var(--text-muted)', fontSize: '12px' }}>
            <strong style={{ color: 'var(--priority-high)' }}>Treat backup.json like a key.</strong> It contains your request database and configured osu!/Google credentials. Never upload it to a public repository, issue, chat, or file-sharing link. Store it privately and share it only through a trusted, secure channel.
          </div>

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

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <HardDrive size={18} style={{ color: 'var(--osu-pink)' }} />
            Data Usage
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Storage used by beatmap covers downloaded for offline display.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '14px 16px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: '600' }}>Cached covers</div>
              {!coverStorageError && coverStorageUsage && (
                <div style={{ marginTop: '3px', fontSize: '11px', color: 'var(--text-muted)' }}>
                  {coverStorageUsage.coverCount} {coverStorageUsage.coverCount === 1 ? 'cover' : 'covers'}
                </div>
              )}
            </div>
            <div style={{ fontSize: '16px', fontWeight: '700', fontVariantNumeric: 'tabular-nums' }}>
              {coverStorageError ? 'Unavailable' : coverStorageUsage ? formatBytes(coverStorageUsage.coverCacheBytes) : 'Calculating...'}
            </div>
          </div>
        </div>

      </div>

      {isDeleteConfirmOpen && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) cancelDeleteConfirmation();
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            backgroundColor: 'rgba(0, 0, 0, 0.65)'
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-all-data-title"
            onSubmit={handleDeleteAllData}
            className="card"
            style={{ width: '100%', maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '16px', border: '1px solid rgba(231, 76, 60, 0.65)', boxShadow: 'var(--shadow-lg)' }}
          >
            <div>
              <h2 id="delete-all-data-title" style={{ fontSize: '18px', color: 'var(--priority-high)', marginBottom: '8px' }}>Delete all local data?</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                This permanently deletes all requests, history, tags, cached osu! metadata, downloaded cover images, saved credentials, and Google Sheets connection data. Google Sheets already published to Drive will remain there.
              </p>
            </div>
            <div>
              <label htmlFor="delete-all-data-confirmation" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                Type <code>DELETE</code> to confirm
              </label>
              <input
                id="delete-all-data-confirmation"
                type="text"
                className="input-text"
                value={deleteConfirmationText}
                onChange={(event) => setDeleteConfirmationText(event.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck="false"
                disabled={isDeletingAllData}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" className="btn-secondary" onClick={cancelDeleteConfirmation} disabled={isDeletingAllData}>Cancel</button>
              <button
                type="submit"
                className="btn-secondary"
                disabled={isDeletingAllData || deleteConfirmationText !== 'DELETE'}
                style={{ color: 'var(--priority-high)', borderColor: 'rgba(231, 76, 60, 0.5)' }}
              >
                <Trash2 size={14} />
                <span>{isDeletingAllData ? 'Deleting...' : 'Delete Everything'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {isSpreadsheetImportOpen && (
        <SpreadsheetImportModal
          onClose={() => setIsSpreadsheetImportOpen(false)}
          onImported={async () => {
            await onSpreadsheetImported();
            await loadMetadataSyncStatus();
          }}
          onNotify={onNotify}
          categoryDefinitions={categoryDefinitions}
        />
      )}

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
