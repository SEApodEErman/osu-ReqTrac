import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import Dashboard from './components/Dashboard';
import RequestsTable from './components/RequestsTable';
import SettingsPanel from './components/SettingsPanel';
import RequestDrawer from './components/RequestDrawer';
import AddRequestDialog from './components/AddRequestDialog';
import ImportDialog from './components/ImportDialog';
import SetupDialog from './components/SetupDialog';
import ShortcutsDialog from './components/ShortcutsDialog';
import ConfirmModal from './components/ConfirmModal';
import ToastStack from './components/Toast';
import { isAnyDialogOpen } from './components/ui/Dialog';
import { api } from './api/client';
import { useAppData } from './hooks/useAppData';
import { usePreferences } from './hooks/usePreferences';
import { useToasts } from './hooks/useToasts';
import { useRequestActions } from './hooks/useRequestActions';
import { ACTIVE_REQUEST_STATUSES } from './utils/requestConstants';
import { beatmapIdFromLink, beatmapsetIdFromLink, extractOsuBeatmapLink } from './utils/osuLinks';

const METADATA_POLL_MS = 3000;
const METADATA_LIST_REFRESH_MS = 10000;

function resolveTheme(preference) {
  if (preference !== 'system') return preference;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function isTypingTarget(element) {
  return Boolean(element?.closest?.('input, textarea, select, [contenteditable="true"]'));
}

export default function App() {
  const { preferences, isLoaded: preferencesLoaded, hydrate, setPreference, reload: reloadPreferences } = usePreferences();
  const data = useAppData({ onSettingsLoaded: settings => hydrate(settings?.preferences) });
  const toasts = useToasts();
  const { showToast } = toasts;
  const actions = useRequestActions({ data, toasts, categories: data.categories });

  const [activeView, setActiveView] = useState('overview');
  const [settingsSection, setSettingsSection] = useState(null);
  const [openRequestId, setOpenRequestId] = useState(null);
  const [addDialog, setAddDialog] = useState(null);
  const [importDialog, setImportDialog] = useState(null);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [viewStates, setViewStates] = useState({});
  const [metadataSyncStatus, setMetadataSyncStatus] = useState(null);
  const [isDraggingLink, setIsDraggingLink] = useState(false);
  const searchInputRef = useRef(null);
  const confirmResolverRef = useRef(null);
  const offeredClipboardLinksRef = useRef(new Set());
  const setupShownRef = useRef(false);

  const { requests: allRequests, settings, categories, tags, refreshRequests, refreshStats } = data;
  const isConfigured = Boolean(settings?.isConfigured);
  const connectedAccount = settings?.connectedAccount || null;

  const requests = useMemo(
    () => (actions.pendingDeleteIds.size ? allRequests.filter(request => !actions.pendingDeleteIds.has(request.id)) : allRequests),
    [actions.pendingDeleteIds, allRequests],
  );

  // ---- Theme ---------------------------------------------------------------
  useEffect(() => {
    const apply = () => document.documentElement.setAttribute('data-theme', resolveTheme(preferences.theme));
    apply();
    if (preferences.theme !== 'system') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    media.addEventListener?.('change', apply);
    return () => media.removeEventListener?.('change', apply);
  }, [preferences.theme]);

  // ---- Confirmation dialog -------------------------------------------------
  const requestConfirmation = useCallback(options => new Promise((resolve) => {
    confirmResolverRef.current?.(false);
    confirmResolverRef.current = resolve;
    setConfirmation(options);
  }), []);

  const finishConfirmation = useCallback((confirmed) => {
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmation(null);
    resolve?.(confirmed);
  }, []);

  // ---- Per-view filters and sort (search stays in memory only) -------------
  useEffect(() => {
    if (preferencesLoaded) setViewStates(current => ({ ...(preferences.views || {}), ...current }));
    // Seed once from stored preferences.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferencesLoaded]);

  const viewStatesRef = useRef(viewStates);
  viewStatesRef.current = viewStates;

  const updateViewState = useCallback((key, patch) => {
    const next = { ...(viewStatesRef.current[key] || {}), ...patch };
    viewStatesRef.current = { ...viewStatesRef.current, [key]: next };
    setViewStates(viewStatesRef.current);
    const persistable = { ...next };
    delete persistable.search;
    // Typing in search changes nothing that is stored, so skip the save.
    setPreference('views', views => (JSON.stringify(views?.[key]) === JSON.stringify(persistable)
      ? views
      : { ...(views || {}), [key]: persistable }));
  }, [setPreference]);

  // ---- First-run setup -----------------------------------------------------
  useEffect(() => {
    if (setupShownRef.current || !preferencesLoaded || !settings) return;
    setupShownRef.current = true;
    if (!settings.isConfigured && !preferences.setupDismissed) setIsSetupOpen(true);
  }, [preferences.setupDismissed, preferencesLoaded, settings]);

  // ---- Metadata sync progress ---------------------------------------------
  const hasPendingMetadata = useMemo(
    () => allRequests.some(request => request.metadata_sync_status === 'Pending' || request.metadata_sync_status === 'Processing'),
    [allRequests],
  );

  useEffect(() => {
    if (!hasPendingMetadata) {
      setMetadataSyncStatus(current => (current && !current.Pending && !current.Processing ? current : null));
      return undefined;
    }
    let cancelled = false;
    let timer = null;
    let lastSettled = null;
    let lastListRefresh = Date.now();
    const poll = async () => {
      let keepPolling = true;
      try {
        const status = await api.get('/api/beatmaps/sync/status');
        if (cancelled) return;
        setMetadataSyncStatus(current => (JSON.stringify(current) === JSON.stringify(status) ? current : status));
        const active = (status.Pending || 0) + (status.Processing || 0);
        const settled = (status.Completed || 0) + (status.Failed || 0);
        if (active === 0) {
          keepPolling = false;
          await Promise.all([refreshRequests(), refreshStats()]);
          return;
        }
        // Show synced maps as they arrive without refetching the list every poll.
        if (lastSettled !== null && settled !== lastSettled && Date.now() - lastListRefresh >= METADATA_LIST_REFRESH_MS) {
          lastListRefresh = Date.now();
          await refreshRequests();
        }
        lastSettled = settled;
      } catch (error) {
        console.error('Failed to poll metadata sync:', error);
      } finally {
        if (!cancelled && keepPolling) timer = window.setTimeout(poll, METADATA_POLL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasPendingMetadata, refreshRequests, refreshStats]);

  // ---- Navigation helpers --------------------------------------------------
  const navigate = useCallback((view, section = null) => {
    setActiveView(view);
    setSettingsSection(view === 'settings' ? section : null);
  }, []);

  const activeCategoryId = activeView.startsWith('requests-') && activeView !== 'requests-all' ? Number(activeView.slice('requests-'.length)) : null;
  const activeCategory = activeCategoryId ? categories.find(category => category.id === activeCategoryId) : null;

  // A category that was archived or deleted falls back to All requests.
  useEffect(() => {
    if (activeCategoryId && categories.length && !activeCategory) setActiveView('requests-all');
  }, [activeCategory, activeCategoryId, categories.length]);

  const openAddRequest = useCallback((initialLink = '') => {
    setAddDialog({ initialLink, categoryId: activeCategoryId });
  }, [activeCategoryId]);

  const openImport = useCallback(() => setImportDialog({ categoryId: activeCategoryId }), [activeCategoryId]);

  const showRequests = useCallback((categoryKey, filters = {}) => {
    const key = categoryKey === 'all' ? 'all' : String(categoryKey);
    updateViewState(key, { status: '', priority: '', tag: '', due: '', sync: '', search: '', ...filters });
    navigate(key === 'all' ? 'requests-all' : `requests-${key}`);
  }, [navigate, updateViewState]);

  const openRequest = useCallback((requestOrId) => {
    setOpenRequestId(typeof requestOrId === 'object' ? requestOrId.id : Number(requestOrId));
  }, []);

  const drawerRequest = openRequestId ? requests.find(request => request.id === openRequestId) : null;
  useEffect(() => {
    if (openRequestId && data.requestsLoaded && !drawerRequest && !allRequests.some(request => request.id === openRequestId)) {
      setOpenRequestId(null);
    }
  }, [allRequests, data.requestsLoaded, drawerRequest, openRequestId]);

  const onDataReplaced = useCallback(async () => {
    setOpenRequestId(null);
    data.setStatsCategoryId('all');
    await Promise.all([data.refreshAll(), reloadPreferences()]);
  }, [data, reloadPreferences]);

  // ---- Global keyboard shortcuts -----------------------------------------
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented || isAnyDialogOpen()) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && !event.shiftKey && !event.altKey) {
        if (key === 'n') { event.preventDefault(); openAddRequest(); return; }
        if (key === 'i') { event.preventDefault(); openImport(); return; }
        if (key === 'f' || key === 'k') {
          event.preventDefault();
          if (!activeView.startsWith('requests-')) navigate('requests-all');
          window.setTimeout(() => { searchInputRef.current?.focus(); searchInputRef.current?.select(); }, 0);
          return;
        }
        if (key === '1') { event.preventDefault(); navigate('overview'); return; }
        if (key === '2') { event.preventDefault(); navigate('requests-all'); return; }
        if (key === ',') { event.preventDefault(); navigate('settings'); return; }
        if (key === 'b') { event.preventDefault(); setPreference('sidebarCollapsed', collapsed => !collapsed); return; }
      }
      if (isTypingTarget(event.target) || mod || event.altKey) return;
      if (event.key === '?') { event.preventDefault(); setIsShortcutsOpen(true); return; }
      if (event.key === '/' && activeView.startsWith('requests-')) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeView, navigate, openAddRequest, openImport, setPreference]);

  // ---- Offer to add a copied beatmap link ---------------------------------
  const isTrackedLink = useCallback((link) => {
    const setId = beatmapsetIdFromLink(link);
    if (setId) return allRequests.some(request => Number(request.beatmapset_id) === setId);
    const beatmapId = beatmapIdFromLink(link);
    return allRequests.some(request => (request.search_difficulties || []).some(difficulty => Number(difficulty.id) === beatmapId)
      || request.input_link === link);
  }, [allRequests]);

  useEffect(() => {
    const readClipboard = window.electronAPI?.readClipboardText;
    if (!preferences.clipboardDetection || !readClipboard || !isConfigured) return undefined;
    const checkClipboard = async () => {
      if (isAnyDialogOpen()) return;
      try {
        const link = extractOsuBeatmapLink(await readClipboard());
        if (!link || offeredClipboardLinksRef.current.has(link) || isTrackedLink(link)) return;
        offeredClipboardLinksRef.current.add(link);
        showToast('You copied a beatmap link you don’t track yet.', 'info', {
          title: 'Add this beatmap?',
          duration: 10000,
          action: { label: 'Add request', onClick: () => openAddRequest(link) },
        });
      } catch {
        // Clipboard access can fail while another app holds it; try next time.
      }
    };
    window.addEventListener('focus', checkClipboard);
    return () => window.removeEventListener('focus', checkClipboard);
  }, [isConfigured, isTrackedLink, openAddRequest, preferences.clipboardDetection, showToast]);

  // ---- Drop a beatmap link anywhere to add it -----------------------------
  useEffect(() => {
    let dragDepth = 0;
    const carriesText = event => [...(event.dataTransfer?.types || [])].some(type => type === 'text/uri-list' || type === 'text/plain');
    const onDragEnter = (event) => {
      if (!carriesText(event)) return;
      dragDepth += 1;
      setIsDraggingLink(true);
    };
    const onDragLeave = () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) setIsDraggingLink(false);
    };
    const onDragOver = (event) => {
      // Never let a dropped link navigate the app window away.
      event.preventDefault();
    };
    const onDrop = (event) => {
      event.preventDefault();
      dragDepth = 0;
      setIsDraggingLink(false);
      if (event.target.closest?.('input, textarea')) return;
      const text = event.dataTransfer?.getData('text/uri-list') || event.dataTransfer?.getData('text/plain');
      const link = extractOsuBeatmapLink(text);
      if (link && !isAnyDialogOpen()) {
        if (isTrackedLink(link)) showToast('You already track this beatmap.', 'info', { duration: 3000 });
        else openAddRequest(link);
      }
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [isTrackedLink, openAddRequest, showToast]);

  // ---- App updates ---------------------------------------------------------
  useEffect(() => {
    const remove = window.electronAPI?.onUpdateDownloaded?.(({ version }) => {
      showToast(`Version ${version} is ready. Restart to finish updating.`, 'info', {
        title: 'Update downloaded',
        duration: 0,
        action: { label: 'Restart now', onClick: () => void window.electronAPI.installUpdate?.() },
      });
    });
    return () => remove?.();
  }, [showToast]);

  // ---- Derived view data ---------------------------------------------------
  const activeCounts = useMemo(() => {
    const counts = { all: 0 };
    for (const request of requests) {
      if (!ACTIVE_REQUEST_STATUSES.includes(request.request_status)) continue;
      counts.all += 1;
      for (const category of request.categories || []) counts[category.category_id] = (counts[category.category_id] || 0) + 1;
    }
    return counts;
  }, [requests]);

  const viewRequests = useMemo(() => {
    if (!activeView.startsWith('requests-')) return requests;
    if (!activeCategoryId) return requests;
    return requests.filter(request => (request.categories || []).some(category => Number(category.category_id) === activeCategoryId));
  }, [activeCategoryId, activeView, requests]);

  const viewKey = activeCategoryId ? String(activeCategoryId) : 'all';
  const sectionName = activeView === 'overview' ? 'Overview' : activeView === 'settings' ? 'Settings' : activeCategory?.name || 'All requests';

  const setColumnsPreference = useCallback((value) => {
    setPreference('columns', columns => {
      const next = { ...(columns || {}) };
      if (value) next[viewKey] = value; else delete next[viewKey];
      return next;
    });
  }, [setPreference, viewKey]);

  const handleViewStateChange = useCallback(patch => updateViewState(viewKey, patch), [updateViewState, viewKey]);

  const renderView = () => {
    if (activeView === 'overview') {
      return (
        <Dashboard
          stats={data.stats}
          statsLoading={data.statsLoading}
          requests={requests}
          requestsLoaded={data.requestsLoaded}
          categories={categories}
          selectedCategoryId={data.statsCategoryId}
          onCategoryChange={data.setStatsCategoryId}
          onOpenRequest={openRequest}
          onShowRequests={showRequests}
          onAddRequest={() => openAddRequest()}
          onImport={openImport}
          onOpenSetup={() => setIsSetupOpen(true)}
          isConfigured={isConfigured}
        />
      );
    }
    if (activeView === 'settings') {
      return (
        <SettingsPanel
          key={settingsSection || 'settings'}
          settings={settings}
          preferences={preferences}
          setPreference={setPreference}
          actions={actions}
          isDateRefreshRunning={actions.isDateRefreshRunning}
          initialSection={settingsSection}
          onSettingsChanged={data.refreshSettings}
          onCategoriesChanged={data.refreshCatalogs}
          onDataReplaced={onDataReplaced}
          onOpenImport={openImport}
          onOpenSetup={() => setIsSetupOpen(true)}
          onOpenShortcuts={() => setIsShortcutsOpen(true)}
          onNotify={showToast}
          onRequestConfirmation={requestConfirmation}
        />
      );
    }
    return (
      <RequestsTable
        key={viewKey}
        title={activeCategory?.name || 'All requests'}
        categoryDefinition={activeCategory}
        requests={viewRequests}
        totalRequestCount={requests.length}
        categories={categories}
        tagSuggestions={tags}
        viewState={viewStates[viewKey]}
        onViewStateChange={handleViewStateChange}
        columnsPreference={preferences.columns?.[viewKey]}
        onColumnsPreferenceChange={setColumnsPreference}
        density={preferences.density}
        onDensityChange={density => setPreference('density', density)}
        actions={actions}
        isDateRefreshRunning={actions.isDateRefreshRunning}
        onOpenRequest={openRequest}
        onAddRequest={() => openAddRequest()}
        onImport={openImport}
        searchInputRef={searchInputRef}
        onRequestConfirmation={requestConfirmation}
      />
    );
  };

  return (
    <div className="app-shell">
      <TopBar
        sectionName={sectionName}
        onToggleSidebar={() => setPreference('sidebarCollapsed', collapsed => !collapsed)}
        isSidebarCollapsed={preferences.sidebarCollapsed}
        isConfigured={isConfigured}
        metadataSyncStatus={metadataSyncStatus}
        onOpenSettings={(section = 'osu') => navigate('settings', section)}
      />
      <div className="app-body">
        <Sidebar
          activeView={activeView}
          onNavigate={navigate}
          categories={categories}
          activeCounts={activeCounts}
          connectedAccount={connectedAccount}
          isConfigured={isConfigured}
          isCollapsed={preferences.sidebarCollapsed}
        />
        <main className="main">
          {data.requestsError && !data.requestsLoaded ? (
            <div className="view"><div className="view-inner"><div className="panel"><div className="empty-state">
              <h3>Couldn’t load your requests</h3>
              <p>{data.requestsError.message}</p>
              <div className="view-actions"><button type="button" className="btn btn-primary" onClick={() => void data.refreshAll()}>Try again</button></div>
            </div></div></div></div>
          ) : renderView()}
        </main>
      </div>

      {drawerRequest && (
        <RequestDrawer
          key={drawerRequest.id}
          request={drawerRequest}
          categories={categories}
          tagSuggestions={tags}
          connectedAccount={connectedAccount}
          actions={actions}
          onClose={() => setOpenRequestId(null)}
          onRequestConfirmation={requestConfirmation}
          onNotify={showToast}
        />
      )}

      {addDialog && (
        <AddRequestDialog
          initialLink={addDialog.initialLink}
          categories={categories}
          tagSuggestions={tags}
          defaultCategoryId={addDialog.categoryId}
          lastCategories={preferences.lastCategories}
          connectedAccount={connectedAccount}
          isConfigured={isConfigured}
          onRememberCategories={selection => setPreference('lastCategories', selection)}
          onCreate={actions.createRequest}
          onAddToExisting={actions.addCategoriesToExisting}
          onOpenRequest={openRequest}
          onClose={() => setAddDialog(null)}
          onNotify={showToast}
        />
      )}

      {importDialog && (
        <ImportDialog
          categories={categories}
          defaultCategoryId={importDialog.categoryId}
          onImportLinks={actions.importBeatmapLinks}
          onSpreadsheetImported={() => Promise.all([data.refreshRequests(), data.refreshStats(), data.refreshCatalogs()])}
          onOpenBackupSettings={() => navigate('settings', 'data')}
          onClose={() => setImportDialog(null)}
          onNotify={showToast}
        />
      )}

      {isSetupOpen && (
        <SetupDialog
          isConfigured={isConfigured}
          connectedAccount={connectedAccount}
          onSettingsChanged={data.refreshSettings}
          onFinished={() => { setPreference('setupDismissed', true); setIsSetupOpen(false); }}
          onSkip={() => {
            setPreference('setupDismissed', true);
            setIsSetupOpen(false);
            if (!isConfigured) showToast('You can connect osu! any time from Settings.', 'info', { duration: 4000 });
          }}
          onAddRequest={() => openAddRequest()}
          onImport={openImport}
          onRestoreBackup={() => navigate('settings', 'data')}
        />
      )}

      {isShortcutsOpen && <ShortcutsDialog onClose={() => setIsShortcutsOpen(false)} />}

      {confirmation && (
        <ConfirmModal
          {...confirmation}
          onConfirm={() => finishConfirmation(true)}
          onCancel={() => finishConfirmation(false)}
        />
      )}

      {isDraggingLink && <div className="drop-overlay">Drop an osu! beatmap link to add it</div>}

      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismissToast} />
    </div>
  );
}

