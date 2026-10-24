import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Info,
  Keyboard,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  RefreshCw,
  RotateCcw,
  Sheet,
  SlidersHorizontal,
  Sun,
  Tags,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react';
import Avatar from './ui/Avatar';
import { api } from '../api/client';
import { formatDateTime } from '../utils/dates';
import { openExternal } from '../utils/osuLinks';
import { OsuAppInstructions, testAndSaveCredentials } from './SetupDialog';

// Injected at build time from the ROOT package.json version (single source of
// truth for releases) — see vite.config.js. Never hardcode a version here.
const APP_VERSION = __APP_VERSION__;
const REPOSITORY_URL = 'https://github.com/seapodeerman/osu-ReqTrac';

const SECTIONS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'osu', label: 'osu! connection', icon: KeyRound },
  { id: 'categories', label: 'Categories', icon: Tags },
  { id: 'google', label: 'Google Sheets', icon: Sheet },
  { id: 'data', label: 'Data and backups', icon: Database },
  { id: 'danger', label: 'Danger zone', icon: AlertCircle },
  { id: 'about', label: 'About', icon: Info },
];

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value.toFixed(index === 0 || value >= 100 ? 0 : 1)} ${units[index]}`;
}

function Section({ id, title, description, children, className = '' }) {
  return (
    <section id={`settings-${id}`} data-section={id} className="settings-section">
      <div>
        <h2 className="settings-section-title">{title}</h2>
        {description && <p className="settings-section-description">{description}</p>}
      </div>
      <div className={`panel ${className}`}>{children}</div>
    </section>
  );
}

function Row({ title, description, children }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-title">{title}</div>
        {description && <div className="settings-row-description">{description}</div>}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  );
}

function OsuConnection({ settings, onSettingsChanged, onNotify, onRequestConfirmation }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showCredentialForm, setShowCredentialForm] = useState(!settings?.isConfigured);
  const [identity, setIdentity] = useState('');
  const [busy, setBusy] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const account = settings?.connectedAccount;

  useEffect(() => {
    if (!settings?.isConfigured) setShowCredentialForm(true);
  }, [settings?.isConfigured]);

  const testConnection = async () => {
    setBusy('test');
    window.dispatchEvent(new Event('reqtrac:api-activity'));
    try {
      const result = await api.post('/api/settings/test-credentials', {});
      setTestResult({ ok: true, at: Date.now(), message: 'osu! accepted your saved credentials.' });
      return result;
    } catch (error) {
      setTestResult({ ok: false, message: error.data?.error || error.message });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const saveCredentials = async (event) => {
    event.preventDefault();
    if (!clientId.trim() || !clientSecret.trim()) return;
    setBusy('save');
    const result = await testAndSaveCredentials(clientId, clientSecret);
    setBusy(null);
    if (!result.ok) {
      setTestResult({ ok: false, message: result.error });
      return;
    }
    setClientId('');
    setClientSecret('');
    setShowCredentialForm(false);
    setTestResult({ ok: true, message: 'osu! accepted the new credentials. They’re saved.' });
    onNotify('osu! connection saved.', 'success', { duration: 2500 });
    await onSettingsChanged();
  };

  const saveIdentity = async (event) => {
    event.preventDefault();
    if (!identity.trim()) return;
    setBusy('identity');
    try {
      await api.post('/api/settings', { user: identity.trim() });
      setIdentity('');
      const next = await onSettingsChanged();
      onNotify(`This computer now knows you as ${next?.connectedAccount?.username || 'your account'}.`, 'success', { duration: 3000 });
    } catch (error) {
      onNotify(error.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const removeIdentity = async () => {
    const confirmed = await onRequestConfirmation({
      title: 'Remove your osu! account?',
      message: 'ReqTrac will stop marking difficulties as yours and will count you in requester rankings again. Your requests stay as they are.',
      confirmLabel: 'Remove account',
    });
    if (!confirmed) return;
    await api.post('/api/settings/disconnect').catch(error => onNotify(error.message, 'error'));
    await onSettingsChanged();
  };

  return (
    <>
      <Row
        title="osu! API access"
        description={settings?.isConfigured
          ? 'Beatmap titles, difficulties, covers, and requester profiles are read from osu! with your OAuth application.'
          : 'Not set up. Requests can still be tracked by hand, but nothing is filled in from osu!.'}
      >
        {settings?.isConfigured && (
          <>
            <button type="button" className="btn btn-secondary" onClick={testConnection} disabled={Boolean(busy)}>
              {busy === 'test' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}Test connection
            </button>
            {!showCredentialForm && <button type="button" className="btn btn-ghost" onClick={() => setShowCredentialForm(true)}>Replace credentials</button>}
          </>
        )}
      </Row>
      {testResult && (
        <div style={{ padding: '0 var(--space-5) var(--space-4)' }}>
          <div className={`callout ${testResult.ok ? 'callout-success' : 'callout-danger'}`} role="status">
            {testResult.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}<span>{testResult.message}</span>
          </div>
        </div>
      )}
      {showCredentialForm && (
        <form className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch' }} onSubmit={saveCredentials}>
          <OsuAppInstructions />
          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="settings-client-id">Client ID</label>
              <input id="settings-client-id" className="input" inputMode="numeric" value={clientId} onChange={event => setClientId(event.target.value)} placeholder={settings?.isConfigured ? 'Saved — enter a new one to replace it' : 'e.g. 41234'} autoComplete="off" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="settings-client-secret">Client Secret</label>
              <input id="settings-client-secret" className="input" type="password" value={clientSecret} onChange={event => setClientSecret(event.target.value)} placeholder={settings?.isConfigured ? 'Saved — enter a new one to replace it' : '40 characters'} autoComplete="off" />
            </div>
          </div>
          <div className="view-actions">
            <button type="submit" className="btn btn-primary" disabled={Boolean(busy) || !clientId.trim() || !clientSecret.trim()}>
              {busy === 'save' ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />}{busy === 'save' ? 'Checking with osu!…' : 'Check and save'}
            </button>
            {settings?.isConfigured && <button type="button" className="btn btn-ghost" onClick={() => { setShowCredentialForm(false); setClientId(''); setClientSecret(''); }}>Cancel</button>}
          </div>
        </form>
      )}
      <Row
        title="Your osu! account"
        description="Used to spot your own guest difficulties and to leave you out of your requester rankings. ReqTrac never signs in as you."
      />
      <div style={{ padding: '0 var(--space-5) var(--space-5)' }}>
        {account ? (
          <div className="panel-inset account-preview">
            <Avatar src={account.avatar} name={account.username} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 650 }}>{account.username}</div>
              <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>osu! user #{account.id}</div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openExternal(`https://osu.ppy.sh/users/${account.id}`)}><ExternalLink size={13} />Profile</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={removeIdentity}>Remove</button>
          </div>
        ) : (
          <form className="view-actions" style={{ flexWrap: 'nowrap' }} onSubmit={saveIdentity}>
            <input className="input" value={identity} onChange={event => setIdentity(event.target.value)} placeholder="Username, profile link, or user ID" aria-label="Your osu! username, profile link, or user ID" />
            <button type="submit" className="btn btn-primary" disabled={!identity.trim() || Boolean(busy)}>
              {busy === 'identity' ? <Loader2 size={14} className="spin" /> : <UserRound size={14} />}Find account
            </button>
          </form>
        )}
      </div>
    </>
  );
}

function CategoriesEditor({ onCategoriesChanged, onNotify, onRequestConfirmation }) {
  const [allCategories, setAllCategories] = useState([]);
  const [newName, setNewName] = useState('');
  const [drafts, setDrafts] = useState({});

  const refresh = useCallback(async () => {
    try {
      setAllCategories(await api.get('/api/categories?includeArchived=1'));
    } catch (error) {
      onNotify(`Couldn’t load categories: ${error.message}`, 'error');
    }
  }, [onNotify]);

  useEffect(() => { void refresh(); }, [refresh]);

  const sorted = [...allCategories].sort((a, b) => (b.is_active - a.is_active) || a.sort_order - b.sort_order || a.id - b.id);
  const active = sorted.filter(category => category.is_active);

  const update = async (category, updates) => {
    try {
      await api.patch(`/api/categories/${category.id}`, updates);
      await Promise.all([refresh(), onCategoriesChanged()]);
      return true;
    } catch (error) {
      onNotify(error.message, 'error');
      return false;
    }
  };

  const rename = async (category) => {
    const name = (drafts[category.id] ?? category.name).trim();
    if (!name || name === category.name) {
      setDrafts(current => ({ ...current, [category.id]: undefined }));
      return;
    }
    if (await update(category, { name })) {
      setDrafts(current => ({ ...current, [category.id]: undefined }));
      onNotify(`Renamed to “${name}”.`, 'success', { duration: 2500 });
    }
  };

  const move = async (category, direction) => {
    const index = active.findIndex(item => item.id === category.id);
    const swap = active[index + direction];
    if (!swap) return;
    await update(category, { sort_order: swap.sort_order });
    await update(swap, { sort_order: category.sort_order });
  };

  const create = async (event) => {
    event.preventDefault();
    if (!newName.trim()) return;
    try {
      const created = await api.post('/api/categories', { name: newName.trim() });
      setNewName('');
      await Promise.all([refresh(), onCategoriesChanged()]);
      onNotify(`Added the “${created.name}” category.`, 'success', { duration: 2500 });
    } catch (error) {
      onNotify(error.message, 'error');
    }
  };

  const archive = async (category) => {
    const confirmed = await onRequestConfirmation({
      title: `Archive “${category.name}”?`,
      message: 'It disappears from the sidebar and from new requests. Requests already in it keep it, and you can restore it any time.',
      confirmLabel: 'Archive',
      tone: 'primary',
    });
    if (!confirmed) return;
    try {
      await api.delete(`/api/categories/${category.id}`);
      await Promise.all([refresh(), onCategoriesChanged()]);
    } catch (error) {
      onNotify(error.message, 'error');
    }
  };

  return (
    <>
      {sorted.map(category => {
        const activeIndex = active.findIndex(item => item.id === category.id);
        return (
          <div key={category.id} className="category-row" data-archived={!category.is_active}>
            <input
              className="input input-sm"
              value={drafts[category.id] ?? category.name}
              disabled={!category.is_active}
              onChange={event => setDrafts(current => ({ ...current, [category.id]: event.target.value }))}
              onBlur={() => void rename(category)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setDrafts(current => ({ ...current, [category.id]: undefined }));
                }
              }}
              aria-label={`Category name for ${category.name}`}
              maxLength={80}
            />
            <div className="view-actions" style={{ flexWrap: 'nowrap', gap: 2 }}>
              {category.is_active ? (
                <>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={activeIndex <= 0} onClick={() => void move(category, -1)} aria-label={`Move ${category.name} up`}><ArrowUp size={14} /></button>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={activeIndex === active.length - 1} onClick={() => void move(category, 1)} aria-label={`Move ${category.name} down`}><ArrowDown size={14} /></button>
                </>
              ) : <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>Archived</span>}
            </div>
            <div style={{ width: 96, display: 'flex', justifyContent: 'flex-end' }}>
              {category.system_key ? (
                <span className="muted" style={{ fontSize: 'var(--text-sm)' }} title="Built-in categories keep their special behaviour even when renamed.">Built-in</span>
              ) : category.is_active ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void archive(category)}><Archive size={13} />Archive</button>
              ) : (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void update(category, { is_active: true })}><RotateCcw size={13} />Restore</button>
              )}
            </div>
          </div>
        );
      })}
      <form className="category-row" onSubmit={create}>
        <input className="input input-sm" value={newName} onChange={event => setNewName(event.target.value)} placeholder="New category, e.g. Mods or Video editing" maxLength={80} aria-label="New category name" />
        <span />
        <div style={{ width: 96, display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!newName.trim()}>Add</button>
        </div>
      </form>
    </>
  );
}

function GoogleSheets({ theme, onNotify, onRequestConfirmation }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.get('/api/google/status'));
    } catch (error) {
      console.error('Failed to load Google Sheets status:', error);
    }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const connect = async () => {
    setBusy(true);
    try {
      const data = await api.get('/api/google/auth-url');
      openExternal(data.url);
      onNotify('Finish signing in to Google in your browser. ReqTrac picks up the connection when you come back.', 'info', { duration: 8000 });
    } catch (error) {
      onNotify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    try {
      const resolvedTheme = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
      const data = await api.post('/api/google/sync', { theme: resolvedTheme }, { timeoutMs: 120000 });
      setStatus(current => ({ ...current, connected: true, sheetUrl: data.url, syncedAt: data.syncedAt }));
      onNotify('Your public sheet is up to date.', 'success');
    } catch (error) {
      onNotify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    const confirmed = await onRequestConfirmation({
      title: 'Disconnect Google Sheets?',
      message: 'The sheet stays in your Google Drive and its link keeps working, but ReqTrac stops updating it.',
      confirmLabel: 'Disconnect',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await api.post('/api/google/disconnect');
      setStatus(current => ({ ...current, connected: false, sheetUrl: null, syncedAt: null }));
    } catch (error) {
      onNotify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (status && !status.configured) {
    return <Row title="Not available in this build" description="Publishing to Google Sheets needs a Google app that this copy of ReqTrac wasn’t built with. Official releases include it." />;
  }

  return (
    <>
      <Row
        title={status?.connected ? 'Connected to Google Drive' : 'Publish a read-only copy of your requests'}
        description={status?.connected
          ? 'Sync publishes your osu! requests, including notes, to a sheet anyone with the link can view. Manual requests stay local.'
          : 'ReqTrac creates a formatted sheet in your own Drive that anyone with the link can view — handy for your osu! profile or forum thread.'}
      >
        {!status?.connected ? (
          <button type="button" className="btn btn-primary" onClick={connect} disabled={busy || !status}>
            {busy ? <Loader2 size={14} className="spin" /> : <Sheet size={14} />}Connect Google Drive
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={sync} disabled={busy}>
              {busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}{status.sheetUrl ? 'Sync now' : 'Publish sheet'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={disconnect} disabled={busy}>Disconnect</button>
          </>
        )}
      </Row>
      <div className="muted" style={{ padding: '0 var(--space-5) var(--space-5)', fontSize: 'var(--text-sm)' }}>
        Google access is used to create and update your export sheet and enable link sharing. Disconnect removes the saved connection from this app; it leaves the sheet and its sharing settings in Drive.{' '}
        <button type="button" className="btn-link" onClick={() => openExternal('https://seapodeerman.top/osu-reqtrac/privacy/')}>Privacy policy</button>
        {' · '}
        <button type="button" className="btn-link" onClick={() => openExternal('https://seapodeerman.top/osu-reqtrac/terms/')}>Terms of service</button>
      </div>
      {status?.connected && status.sheetUrl && (
        <div style={{ padding: '0 var(--space-5) var(--space-5)' }}>
          <div className="panel-inset view-actions" style={{ justifyContent: 'space-between' }}>
            <div style={{ minWidth: 0 }}>
              <button type="button" className="btn-link truncate" style={{ maxWidth: 440 }} onClick={() => openExternal(status.sheetUrl)}>{status.sheetUrl}<ExternalLink size={12} /></button>
              {status.syncedAt && <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>Last synced {formatDateTime(status.syncedAt)}</div>}
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(status.sheetUrl).then(() => onNotify('Link copied.', 'success', { duration: 2000 }))}>Copy link</button>
          </div>
        </div>
      )}
      {status?.configured && !status?.hasConnected && (
        <div style={{ padding: '0 var(--space-5) var(--space-5)' }}>
          <div className="callout callout-warning">
            <AlertCircle size={16} />
            <span>Google may show an unverified-app warning until verification is complete. Review the permissions before connecting. Publishing sends your export directly from this computer to Google Drive and enables anyone with the link to view it.</span>
          </div>
        </div>
      )}
    </>
  );
}

function DataSection({ actions, isDateRefreshRunning, onOpenImport, onDataReplaced, onNotify, onRequestConfirmation }) {
  const [syncStatus, setSyncStatus] = useState(null);
  const [failures, setFailures] = useState(null);
  const [usage, setUsage] = useState(null);
  const [busy, setBusy] = useState(null);
  const fileInputRef = useRef(null);

  const loadSyncStatus = useCallback(async () => {
    try {
      setSyncStatus(await api.get('/api/beatmaps/sync/status'));
    } catch {
      setSyncStatus(null);
    }
  }, []);

  useEffect(() => {
    void loadSyncStatus();
    api.get('/api/settings/data-usage').then(setUsage).catch(() => setUsage({ error: true }));
  }, [loadSyncStatus]);

  const syncing = (syncStatus?.Pending || 0) + (syncStatus?.Processing || 0);
  useEffect(() => {
    if (!syncing) return undefined;
    const timer = window.setInterval(() => void loadSyncStatus(), 3000);
    return () => window.clearInterval(timer);
  }, [loadSyncStatus, syncing]);

  const retryFailed = async () => {
    setBusy('retry');
    try {
      const data = await api.post('/api/beatmaps/sync/retry');
      onNotify(data?.message || 'Retrying failed syncs.', 'success');
      setFailures(null);
      window.dispatchEvent(new Event('reqtrac:api-activity'));
      await loadSyncStatus();
    } catch (error) {
      onNotify(error.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const showFailures = async () => {
    if (failures) {
      setFailures(null);
      return;
    }
    try {
      setFailures(await api.get('/api/beatmaps/sync/failed'));
    } catch (error) {
      onNotify(error.message, 'error');
    }
  };

  const restore = async (file) => {
    if (!file) return;
    const confirmed = await onRequestConfirmation({
      title: 'Replace everything with this backup?',
      message: `All requests, categories, tags, and history in the app are replaced by “${file.name}”. Your osu! and Google connections on this computer are kept. Export a backup first if you might want today’s data back.`,
      confirmLabel: 'Restore backup',
      requireText: 'RESTORE',
    });
    if (!confirmed) return;
    setBusy('restore');
    try {
      // The server only parses application/json bodies; some systems report .json files without a type.
      await api.post('/api/migration/import-json', new Blob([file], { type: 'application/json' }), { timeoutMs: 600000 });
      await onDataReplaced();
      onNotify('Backup restored. Covers are downloading again in the background.', 'success');
    } catch (error) {
      onNotify(`Couldn’t restore the backup: ${error.message}`, 'error');
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <Row title="Import requests" description="From a spreadsheet, a public Google Sheet, or a list of beatmap links.">
        <button type="button" className="btn btn-secondary" onClick={onOpenImport}><FileSpreadsheet size={14} />Import…</button>
      </Row>
      <Row
        title="Back up"
        description="Saves every request, category, tag, history entry, and setting to one backup.json file. It includes your osu! and Google credentials, so keep it private like a password."
      >
        <a className="btn btn-secondary" href="/api/migration/export" download="backup.json"><Download size={14} />Export backup</a>
      </Row>
      <Row title="Restore" description="Replaces everything in the app with a backup.json. Covers aren’t stored in backups; they download again after restoring.">
        <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={event => void restore(event.target.files?.[0])} />
        <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={busy === 'restore'}>
          {busy === 'restore' ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}{busy === 'restore' ? 'Restoring…' : 'Restore backup…'}
        </button>
      </Row>
      <Row
        title="Beatmap details from osu!"
        description={syncStatus
          ? `${syncStatus.Completed || 0} up to date${syncing ? ` · ${syncing} syncing` : ''}${syncStatus.Failed ? ` · ${syncStatus.Failed} failed` : ''}`
          : 'Loading…'}
      >
        {syncStatus?.Failed > 0 && (
          <>
            <button type="button" className="btn btn-ghost" onClick={showFailures}>{failures ? 'Hide details' : 'See what failed'}</button>
            <button type="button" className="btn btn-secondary" onClick={retryFailed} disabled={busy === 'retry'}>
              {busy === 'retry' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}Retry failed
            </button>
          </>
        )}
      </Row>
      {failures && (
        <div style={{ padding: '0 var(--space-5) var(--space-5)' }}>
          <div className="panel-inset" style={{ maxHeight: 260, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {failures.length === 0 ? <span className="muted">Nothing has failed.</span> : failures.map(item => (
              <div key={item.beatmapset_id} style={{ fontSize: 'var(--text-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <strong className="truncate">{item.artist && item.title ? `${item.artist} – ${item.title}` : `Beatmapset ${item.beatmapset_id}`}</strong>
                  <span className="muted">{item.attempt_count} attempts</span>
                </div>
                <div style={{ color: 'var(--danger)', overflowWrap: 'anywhere' }}>{item.last_error || 'No error recorded.'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <Row
        title="Use osu! dates for every request"
        description="Sets each osu!-linked request’s added date to its map’s ranked or loved date, or its last-updated date otherwise. Handy after importing. Checks 50 maps per osu! call, so even large libraries finish quickly."
      >
        <button
          type="button"
          className="btn btn-secondary"
          disabled={isDateRefreshRunning}
          onClick={async () => {
            const confirmed = await onRequestConfirmation({
              title: 'Replace every added date with osu! dates?',
              message: 'Every osu!-linked request’s added date is overwritten. Manual requests aren’t touched.',
              confirmLabel: 'Use osu! dates',
              tone: 'primary',
            });
            if (confirmed) void actions.refreshDates(null);
          }}
        >
          <RefreshCw size={14} className={isDateRefreshRunning ? 'spin' : undefined} />{isDateRefreshRunning ? 'Updating…' : 'Update dates'}
        </button>
      </Row>
      <Row
        title="Cover image cache"
        description={usage?.error ? 'Couldn’t measure the cover cache.' : usage ? `${usage.coverCount} cover${usage.coverCount === 1 ? '' : 's'} stored for offline use.` : 'Measuring…'}
      >
        {usage && !usage.error && <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatBytes(usage.coverCacheBytes)}</strong>}
      </Row>
    </>
  );
}

export default function SettingsPanel({
  settings,
  preferences,
  setPreference,
  actions,
  isDateRefreshRunning,
  initialSection,
  onSettingsChanged,
  onCategoriesChanged,
  onDataReplaced,
  onOpenImport,
  onOpenSetup,
  onOpenShortcuts,
  onNotify,
  onRequestConfirmation,
}) {
  const [activeSection, setActiveSection] = useState(initialSection || 'general');
  const scrollRef = useRef(null);

  const scrollTo = useCallback((id, behavior = 'smooth') => {
    const element = scrollRef.current?.querySelector(`#settings-${id}`);
    if (element) element.scrollIntoView({ behavior, block: 'start' });
    setActiveSection(id);
  }, []);

  useEffect(() => {
    if (initialSection) window.setTimeout(() => scrollTo(initialSection, 'auto'), 0);
  }, [initialSection, scrollTo]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActiveSection(visible.target.dataset.section);
    }, { root, rootMargin: '0px 0px -65% 0px' });
    root.querySelectorAll('[data-section]').forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const deleteAllData = async () => {
    const confirmed = await onRequestConfirmation({
      title: 'Delete all data?',
      message: 'Every request, category you created, tag, history entry, cached map, cover, preference, and saved credential on this computer is permanently deleted. Sheets already published to Google Drive stay there.',
      confirmLabel: 'Delete everything',
      requireText: 'DELETE',
    });
    if (!confirmed) return;
    try {
      await api.post('/api/settings/delete-all-data');
      await onDataReplaced();
      onNotify('All data was deleted.', 'success');
    } catch (error) {
      onNotify(`Couldn’t delete everything: ${error.message}`, 'error');
    }
  };

  return (
    <div className="view" ref={scrollRef}>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <h1 className="view-title" style={{ marginBottom: 'var(--space-4)' }}>Settings</h1>
          {SECTIONS.map(section => (
            <button key={section.id} type="button" className="nav-item" aria-current={activeSection === section.id ? 'page' : undefined} onClick={() => scrollTo(section.id)}>
              <section.icon size={16} />
              <span className="nav-item-label">{section.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content">
          <Section id="general" title="General">
            <Row title="Theme" description="Follow your system, or pick one.">
              <div className="segmented" role="group" aria-label="Theme">
                {[['system', 'System', Monitor], ['dark', 'Dark', Moon], ['light', 'Light', Sun]].map(([value, label, Icon]) => (
                  <button key={value} type="button" aria-pressed={preferences.theme === value} onClick={() => setPreference('theme', value)}><Icon size={13} />{label}</button>
                ))}
              </div>
            </Row>
            <Row title="Table rows" description="Compact fits more requests on screen; comfortable shows more of each one.">
              <div className="segmented" role="group" aria-label="Table row height">
                {[['comfortable', 'Comfortable'], ['compact', 'Compact']].map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={preferences.density === value} onClick={() => setPreference('density', value)}>{label}</button>
                ))}
              </div>
            </Row>
            <label className="settings-row" style={{ cursor: 'pointer' }}>
              <div className="settings-row-text">
                <div className="settings-row-title">Offer to add copied beatmap links</div>
                <div className="settings-row-description">When you come back to ReqTrac with an osu! beatmap link on your clipboard that you don’t track yet, offer to add it.</div>
              </div>
              <span className="switch"><input type="checkbox" checked={preferences.clipboardDetection} onChange={event => setPreference('clipboardDetection', event.target.checked)} /></span>
            </label>
            <Row title="Keyboard shortcuts" description="Add requests, search, and move through the table without the mouse.">
              <button type="button" className="btn btn-secondary" onClick={onOpenShortcuts}><Keyboard size={14} />Show shortcuts</button>
            </Row>
            <Row title="First-run setup" description="Walk through connecting osu! and adding your account again.">
              <button type="button" className="btn btn-ghost" onClick={onOpenSetup}>Run setup</button>
            </Row>
          </Section>

          <Section id="osu" title="osu! connection" description="How ReqTrac reads beatmaps and profiles from osu!.">
            <OsuConnection settings={settings} onSettingsChanged={onSettingsChanged} onNotify={onNotify} onRequestConfirmation={onRequestConfirmation} />
          </Section>

          <Section id="categories" title="Categories" description="The kinds of work people request from you. Each one gets its own list in the sidebar. Rename built-in ones freely; they keep their special behaviour.">
            <CategoriesEditor onCategoriesChanged={onCategoriesChanged} onNotify={onNotify} onRequestConfirmation={onRequestConfirmation} />
          </Section>

          <Section id="google" title="Google Sheets">
            <GoogleSheets theme={preferences.theme} onNotify={onNotify} onRequestConfirmation={onRequestConfirmation} />
          </Section>

          <Section id="data" title="Data and backups" description="Everything is stored on this computer. Back it up before reinstalling or moving to another PC.">
            <DataSection
              actions={actions}
              isDateRefreshRunning={isDateRefreshRunning}
              onOpenImport={onOpenImport}
              onDataReplaced={onDataReplaced}
              onNotify={onNotify}
              onRequestConfirmation={onRequestConfirmation}
            />
          </Section>

          <Section id="danger" title="Danger zone" className="danger-zone">
            <Row title="Delete all data" description="Permanently removes every request and setting from this computer. There’s no undo — export a backup first if you might need it.">
              <button type="button" className="btn btn-danger" onClick={deleteAllData}><Trash2 size={14} />Delete all data…</button>
            </Row>
          </Section>

          <section id="settings-about" data-section="about" className="settings-section settings-footer">
            <h2 className="settings-section-title" style={{ color: 'var(--text-main)' }}>About</h2>
            <div>osu!ReqTrac {APP_VERSION}</div>
            <div className="view-actions">
              <button type="button" className="btn-link" onClick={() => openExternal(REPOSITORY_URL)}>Source code<ExternalLink size={12} /></button>
              <button type="button" className="btn-link" onClick={() => openExternal(`${REPOSITORY_URL}/issues/new/choose`)}>Report a problem or suggest something<ExternalLink size={12} /></button>
            </div>
            <div>osu! and related marks are trademarks of ppy Pty Ltd. This project is not affiliated with or endorsed by ppy Pty Ltd.</div>
          </section>
        </div>
      </div>
    </div>
  );
}
