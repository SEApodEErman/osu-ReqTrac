import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import RequestsTable from './components/RequestsTable';
import RequestDetailModal from './components/RequestDetailModal';
import SettingsPanel from './components/SettingsPanel';
import QuickAdd from './components/QuickAdd';
import MultipleRequestsImport from './components/MultipleRequestsImport';
import TopBar from './components/TopBar';
import Toast from './components/Toast';
import ConfirmModal from './components/ConfirmModal';

function getResolvedTheme(preference) {
  if (preference !== 'system') return preference;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const API_REQUEST_TIMEOUT_MS = 30000;
const METADATA_STATUS_POLL_MS = 3000;
const METADATA_LIST_REFRESH_MS = 15000;
const BULK_REQUEST_BATCH_SIZE = 400;

function requestIdBatches(ids) {
  const batches = [];
  for (let index = 0; index < ids.length; index += BULK_REQUEST_BATCH_SIZE) {
    batches.push(ids.slice(index, index + BULK_REQUEST_BATCH_SIZE));
  }
  return batches;
}

function fetchWithTimeout(input, init = {}, timeoutMs = API_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => window.clearTimeout(timeoutId));
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark';
    return localStorage.getItem('theme') || 'system';
  });
  const [requestsList, setRequestsList] = useState([]);
  const [requestSort, setRequestSort] = useState({ sortBy: 'added_date', sortOrder: 'desc' });
  const [statsData, setStatsData] = useState({});
  const [settingsData, setSettingsData] = useState({});
  const [categoryDefinitions, setCategoryDefinitions] = useState([]);
  const [tagCatalog, setTagCatalog] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isMultipleImportOpen, setIsMultipleImportOpen] = useState(false);
  const [showFirstLaunchSetup, setShowFirstLaunchSetup] = useState(false);
  const [osuApiStatus, setOsuApiStatus] = useState(null);
  const [metadataSyncStatus, setMetadataSyncStatus] = useState(null);
  const [toastNotice, setToastNotice] = useState(null);
  const [confirmationRequest, setConfirmationRequest] = useState(null);
  const [isBulkStatusUpdating, setIsBulkStatusUpdating] = useState(false);
  const toastIdRef = useRef(0);
  const bulkStatusUpdateRef = useRef(false);
  const metadataProgressRef = useRef({ settled: null, lastListRefresh: 0 });

  // QuickAdd duplicate check state
  const [duplicateError, setDuplicateError] = useState(null);

  const showToast = useCallback((message, type = 'info', action = null) => {
    setToastNotice({ id: ++toastIdRef.current, message, type, action });
    if ((type === 'error' || type === 'warning') && window.electronAPI?.windowControls?.flashFrame) {
      void window.electronAPI.windowControls.flashFrame();
    }
  }, []);

  const dismissToast = useCallback(() => setToastNotice(null), []);

  const confirmationResolverRef = useRef(null);
  const requestConfirmation = useCallback((options) => new Promise((resolve) => {
    if (confirmationResolverRef.current) confirmationResolverRef.current(false);
    confirmationResolverRef.current = resolve;
    setConfirmationRequest(options);
  }), []);

  const finishConfirmation = useCallback((confirmed) => {
    const resolve = confirmationResolverRef.current;
    confirmationResolverRef.current = null;
    setConfirmationRequest(null);
    resolve?.(confirmed);
  }, []);

  useEffect(() => {
    const removeUpdateListener = window.electronAPI?.onUpdateDownloaded?.(({ version }) => {
      showToast(`Version ${version} is ready to install.`, 'info', {
        label: 'Restart now',
        onClick: () => void window.electronAPI.installUpdate?.(),
      });
    });
    return () => removeUpdateListener?.();
  }, [showToast]);

  const fetchData = async () => {
    try {
      await Promise.all([
        fetchRequests(),
        fetchStats(),
        fetchSettings(),
        fetchCatalogs()
      ]);
    } catch (e) {
      console.error('Failed to load initial data:', e);
    }
  };

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetchWithTimeout('/api/requests');
      if (res.ok) {
        const data = await res.json();
        setRequestsList(data);

        // Keep a detail modal opened during background sync up to date.
        setSelectedRequest(current => {
          if (!current) return current;
          const updated = data.find(request => request.id === current.id);
          return updated
            ? { ...current, ...updated, difficulties: current.difficulties }
            : current;
        });
      }
    } catch (e) {
      console.error('Error fetching requests list:', e);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetchWithTimeout('/api/stats');
      if (res.ok) {
        const data = await res.json();
        setStatsData(data);
      }
    } catch (e) {
      console.error('Error fetching stats:', e);
    }
  }, []);

  const fetchCatalogs = useCallback(async () => {
    try {
      const [categoriesResponse, tagsResponse] = await Promise.all([
        fetchWithTimeout('/api/categories'),
        fetchWithTimeout('/api/tags'),
      ]);
      if (categoriesResponse.ok) setCategoryDefinitions(await categoriesResponse.json());
      if (tagsResponse.ok) setTagCatalog(await tagsResponse.json());
    } catch (error) {
      console.error('Failed to load categories or tags:', error);
    }
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettingsData(data);
        if (!data.isConfigured && !localStorage.getItem('credentialsSetupPromptShown')) {
          localStorage.setItem('credentialsSetupPromptShown', '1');
          setActiveTab('settings');
          setShowFirstLaunchSetup(true);
        }
      }
    } catch (e) {
      console.error('Error fetching settings:', e);
    }
  };

  useEffect(() => {
    const applyTheme = () => {
      document.documentElement.setAttribute('data-theme', getResolvedTheme(theme));
    };

    applyTheme();
    if (theme !== 'system') return undefined;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const handleThemeChange = () => applyTheme();
    mediaQuery.addEventListener?.('change', handleThemeChange);
    return () => mediaQuery.removeEventListener?.('change', handleThemeChange);
  }, [theme]);

  // Load the initial data once the client component mounts.
  useEffect(() => {
    void Promise.all([
      fetch('/api/requests').then(async (res) => {
        if (res.ok) setRequestsList(await res.json());
      }),
      fetch('/api/stats').then(async (res) => {
        if (res.ok) setStatsData(await res.json());
      }),
      fetch('/api/settings').then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setSettingsData(data);
          if (!data.isConfigured && !localStorage.getItem('credentialsSetupPromptShown')) {
            localStorage.setItem('credentialsSetupPromptShown', '1');
            setActiveTab('settings');
            setShowFirstLaunchSetup(true);
          }
        }
      }),
      fetch('/api/categories').then(async res => { if (res.ok) setCategoryDefinitions(await res.json()); }),
      fetch('/api/tags').then(async res => { if (res.ok) setTagCatalog(await res.json()); }),
    ]).catch((error) => {
      console.error('Failed to load initial data:', error);
    });
  }, []);

  const hasPendingMetadata = requestsList.some(request =>
    request.metadata_sync_status === 'Pending' || request.metadata_sync_status === 'Processing'
  );

  useEffect(() => {
    if (!hasPendingMetadata) {
      setMetadataSyncStatus(null);
      return undefined;
    }
    let cancelled = false;
    let timeoutId = null;
    metadataProgressRef.current = { settled: null, lastListRefresh: Date.now() };

    const pollMetadataStatus = async () => {
      let scheduleNext = true;
      try {
        const response = await fetchWithTimeout('/api/beatmaps/sync/status');
        if (!response.ok || cancelled) return;
        const status = await response.json();
        if (cancelled) return;
        setMetadataSyncStatus(status);

        const active = (status.Pending || 0) + (status.Processing || 0);
        const settled = (status.Completed || 0) + (status.Failed || 0);
        const progress = metadataProgressRef.current;
        const progressChanged = progress.settled !== null && progress.settled !== settled;
        progress.settled = settled;

        if (active === 0) {
          scheduleNext = false;
          await Promise.all([fetchRequests(), fetchStats()]);
          return;
        }

        if (progressChanged && Date.now() - progress.lastListRefresh >= METADATA_LIST_REFRESH_MS) {
          progress.lastListRefresh = Date.now();
          await fetchRequests();
        }
      } catch (error) {
        console.error('Failed to poll metadata sync status:', error);
      } finally {
        if (!cancelled && scheduleNext) {
          timeoutId = window.setTimeout(pollMetadataStatus, METADATA_STATUS_POLL_MS);
        }
      }
    };

    void pollMetadataStatus();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [hasPendingMetadata, fetchRequests, fetchStats]);

  useEffect(() => {
    let isMounted = true;
    const pollApiStatus = async () => {
      try {
        const res = await fetch('/api/osu/status');
        if (res.ok && isMounted) setOsuApiStatus(await res.json());
      } catch (error) {
        console.error('Failed to load osu! API status:', error);
      }
    };

    void pollApiStatus();
    const intervalId = window.setInterval(pollApiStatus, 1000);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const toggleTheme = (newTheme) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  const handleOpenRequest = useCallback(async (request) => {
    setSelectedRequest(request);
    if (!request.is_osu_link || !request.beatmapset_id) return;

    try {
      const response = await fetchWithTimeout(`/api/beatmaps/${request.beatmapset_id}?cacheOnly=1`);
      if (!response.ok) return;
      const beatmap = await response.json();
      setSelectedRequest(current => current?.id === request.id
        ? { ...current, difficulties: beatmap.difficulties || [] }
        : current);
    } catch (error) {
      console.error('Failed to load request difficulty details:', error);
    }
  }, []);

  // ADD Request
  const handleAddRequest = async (payload, callback) => {
    setDuplicateError(null);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.status === 409) {
        const errData = await res.json();
        setDuplicateError({
          requestId: errData.requestId,
          message: errData.message
        });
        showToast(errData.message || 'This beatmapset already exists.', 'warning');
        window.setTimeout(() => document.querySelector('[data-duplicate-warning]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
        return { ok: false, reason: 'duplicate', requestId: errData.requestId };
      }

      if (res.ok) {
        await Promise.all([fetchRequests(), fetchStats(), fetchCatalogs()]);
        if (callback) callback();
        return { ok: true };
      } else {
        const errData = await res.json();
        showToast(`Failed to add request: ${errData.error || 'Server Error'}`, 'error');
        return { ok: false, reason: 'server' };
      }
    } catch (e) {
      console.error(e);
      showToast('Network Error. Failed to add request.', 'error');
      return { ok: false, reason: 'network' };
    }
  };

  // Resolve duplicate by adding categories to existing request
  const handleResolveDuplicate = async (requestId, categories, callback) => {
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          add_to_existing_id: requestId,
          categories
        })
      });

      if (res.ok) {
        setDuplicateError(null);
        await Promise.all([fetchRequests(), fetchStats(), fetchCatalogs()]);
        if (callback) callback();
        showToast('Categories successfully added to the existing request!', 'success');
        return { ok: true };
      } else {
        const errData = await res.json();
        showToast(`Failed to resolve duplicate: ${errData.error}`, 'error');
        return { ok: false };
      }
    } catch (e) {
      console.error(e);
      showToast('Network Error.', 'error');
      return { ok: false };
    }
  };

  // UPDATE Request
  const handleUpdateRequest = async (id, payload) => {
    try {
      const res = await fetchWithTimeout(`/api/requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        await Promise.all([fetchRequests(), fetchStats(), fetchCatalogs()]);
        showToast('Request updated successfully.', 'success');
        return true;
      } else {
        let message = `Request update failed (${res.status}).`;
        try {
          const errData = await res.json();
          if (errData.error) message = `Request update failed: ${errData.error}`;
        } catch {
          // Keep the status-based message when the server did not return JSON.
        }
        showToast(message, 'error');
        return false;
      }
    } catch (e) {
      console.error(e);
      const message = e.name === 'AbortError'
        ? 'Request update timed out. Check the local server and osu! API connection.'
        : 'Request update could not reach the local server.';
      showToast(message, 'error');
      return false;
    }
  };

  // DELETE Request
  const handleDeleteRequest = async (id) => {
    try {
      const res = await fetch(`/api/requests/${id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        if (selectedRequest && selectedRequest.id === id) {
          setSelectedRequest(null);
        }
        await Promise.all([fetchRequests(), fetchStats()]);
      } else {
        const errData = await res.json();
        showToast(`Failed to delete request: ${errData.error}`, 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Network Error.', 'error');
    }
  };

  // Bulk status update
  const handleBulkUpdateStatus = async (ids, status) => {
    if (!ids.length) return false;
    if (bulkStatusUpdateRef.current) {
      showToast('A bulk status update is already in progress.', 'warning');
      return false;
    }

    bulkStatusUpdateRef.current = true;
    setIsBulkStatusUpdating(true);
    const trackerId = ++toastIdRef.current;
    let completed = 0;
    let failed = 0;
    setToastNotice({
      id: trackerId,
      type: 'progress',
      persistent: true,
      message: `Updating 0 of ${ids.length} requests to "${status}"...`,
      progress: { completed: 0, total: ids.length }
    });

    const updateTracker = () => {
      const completedCount = completed;
      setToastNotice(current => current?.id === trackerId ? {
        ...current,
        message: `Updating ${completedCount} of ${ids.length} requests to "${status}"...`,
        progress: { completed: completedCount, total: ids.length }
      } : current);
    };

    try {
      for (const batch of requestIdBatches(ids)) {
        try {
          const response = await fetch('/api/requests/bulk', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: batch, request_status: status })
          });
          if (!response.ok) failed += batch.length;
        } catch (error) {
          failed += batch.length;
          console.error('Failed to update request batch:', error);
        } finally {
          completed += batch.length;
          updateTracker();
        }
      }
      await Promise.all([fetchRequests(), fetchStats()]);
      if (failed) {
        showToast(`Updated ${ids.length - failed} of ${ids.length} requests to "${status}". ${failed} failed.`, 'warning');
      } else {
        showToast(`Successfully updated status to "${status}" for ${ids.length} requests.`, 'success');
      }
      return true;
    } catch (e) {
      console.error(e);
      showToast('Failed to update status for some requests.', 'error');
      return false;
    } finally {
      bulkStatusUpdateRef.current = false;
      setIsBulkStatusUpdating(false);
    }
  };

  // Bulk priority update
  const handleBulkUpdatePriority = async (ids, priority) => {
    try {
      for (const batch of requestIdBatches(ids)) {
        const response = await fetch('/api/requests/bulk', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: batch, priority })
        });
        if (!response.ok) throw new Error('Bulk priority update failed');
      }
      await Promise.all([fetchRequests(), fetchStats()]);
      showToast(`Successfully updated priority to "${priority}" for ${ids.length} requests.`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to update priority for some requests.', 'error');
    }
  };

  // Bulk category/type update
  const handleBulkUpdateCategory = async (ids, categoryId, mode) => {
    const category = categoryDefinitions.find(item => item.id === Number(categoryId));
    if (!category) return;
    try {
      for (const batch of requestIdBatches(ids)) {
        const response = await fetch('/api/requests/bulk', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: batch, categoryId: category.id, mode })
        });
        if (!response.ok) throw new Error('One or more category updates failed');
      }

      await Promise.all([fetchRequests(), fetchStats()]);
      showToast(`${mode === 'move' ? 'Moved' : 'Added'} ${ids.length} requests ${mode === 'move' ? 'to' : 'into'} "${category.name}".`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to update request types for some requests.', 'error');
    }
  };

  const handleBulkAddTags = async (ids, tags) => {
    try {
      let changed = 0;
      for (const batch of requestIdBatches(ids)) {
        const response = await fetch('/api/requests/bulk', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: batch, add_tags: tags })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Bulk tag update failed');
        changed += result.updated || 0;
      }
      await Promise.all([fetchRequests(), fetchCatalogs()]);
      showToast(`Added tags to ${changed} request${changed === 1 ? '' : 's'}.`, 'success');
      return true;
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Failed to add tags.', 'error');
      return false;
    }
  };

  // Bulk delete
  const handleBulkDelete = async (ids) => {
    try {
      for (const batch of requestIdBatches(ids)) {
        const response = await fetch('/api/requests/bulk', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: batch })
        });
        if (!response.ok) throw new Error('Bulk delete failed');
      }
      await Promise.all([fetchRequests(), fetchStats()]);
      showToast(`Successfully deleted ${ids.length} requests.`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to delete some requests.', 'error');
    }
  };

  // Save Settings Credentials
  const handleSaveCredentials = async (creds) => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds)
    });
    if (res.ok) {
      await fetchSettings();
    } else {
      throw new Error('Save settings failed');
    }
  };

  // Disconnect Settings osu! profile
  const handleDisconnect = async () => {
    if (await requestConfirmation({
      title: 'Disconnect osu! account?',
      message: 'Your connected osu! account will be removed from ReqTrac. Your tracked requests will remain available.',
      confirmLabel: 'Disconnect',
    })) {
      const res = await fetch('/api/settings/disconnect', { method: 'POST' });
      if (res.ok) {
        await fetchSettings();
      }
    }
  };

  // Delete all locally stored application data from Settings.
  const handleDeleteAllData = async () => {
    const res = await fetch('/api/settings/delete-all-data', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Delete all data failed');
    }

    setSelectedRequest(null);
    localStorage.removeItem('credentialsSetupPromptShown');
    await Promise.all([fetchRequests(), fetchStats(), fetchSettings()]);
  };

  // Beatmap link migration
  const handleImportBeatmapLinks = async (linksText, categories) => {
    try {
      const res = await fetch('/api/migration/import-beatmap-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linksText, categories })
      });

      const data = await res.json();
      if (res.ok) {
        await Promise.all([fetchRequests(), fetchStats()]);
        showToast(data.message, data.apiFailures ? 'warning' : 'success');
        return true;
      } else {
        showToast(`Beatmap Link Import Failed: ${data.error}`, 'error');
        return false;
      }
    } catch (e) {
      console.error(e);
      showToast('Beatmap Link Import Network Error.', 'error');
      return false;
    }
  };

  // JSON Restore Backup
  const handleImportJson = async (backupObj) => {
    try {
      const res = await fetch('/api/migration/import-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupObj)
      });

      const data = await res.json();
      if (res.ok) {
        showToast('Backup database successfully restored!', 'success');
        await fetchData();
        return true;
      } else {
        showToast(`Database Restore Failed: ${data.error}`, 'error');
        return false;
      }
    } catch (e) {
      console.error(e);
      showToast('Database Restore Network Error.', 'error');
      return false;
    }
  };

  const handleSpreadsheetImported = async () => {
    await Promise.all([fetchRequests(), fetchStats(), fetchCatalogs()]);
  };

  // Render correct main view
  const renderMainView = () => {
    if (activeTab === 'dashboard') {
      return (
        <Dashboard
          statsData={statsData}
          requestsList={requestsList}
          onOpenRequest={handleOpenRequest}
          connectedAccount={settingsData.connectedAccount}
        />
      );
    }

    if (activeTab === 'settings') {
      return (
        <SettingsPanel
          settingsData={settingsData}
          theme={theme}
          onThemeChange={toggleTheme}
          showFirstLaunchSetup={showFirstLaunchSetup}
          onDismissFirstLaunchSetup={() => setShowFirstLaunchSetup(false)}
          onSaveCredentials={handleSaveCredentials}
           onDisconnect={handleDisconnect}
          onDeleteAllData={handleDeleteAllData}
          onImportJson={handleImportJson}
          onSpreadsheetImported={handleSpreadsheetImported}
          categoryDefinitions={categoryDefinitions}
          onCategoriesChanged={fetchCatalogs}
           onNotify={showToast}
           onRequestConfirmation={requestConfirmation}
        />
      );
    }

    if (activeTab.startsWith('requests-')) {
      const activeCategoryKey = activeTab.replace('requests-', '');
      const activeCategoryDefinition = activeCategoryKey === 'all'
        ? null
        : categoryDefinitions.find(category => category.id === Number(activeCategoryKey));
      const activeCategory = activeCategoryDefinition?.name || 'All';
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px 0 0 0' }}>

          {/* Add and multi-import actions */}
          <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  setIsQuickAddOpen((current) => !current);
                  setIsMultipleImportOpen(false);
                }}
                className="btn-primary"
                style={{ width: 'fit-content', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <Plus size={18} style={{ color: '#fff' }} />
                <span style={{ fontWeight: '600', lineHeight: '1' }}>{isQuickAddOpen ? 'Close Add Request' : 'Add Request'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsMultipleImportOpen((current) => !current);
                  setIsQuickAddOpen(false);
                }}
                className="btn-secondary"
                style={{ width: 'fit-content', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <Plus size={18} />
                <span style={{ fontWeight: '600', lineHeight: '1' }}>{isMultipleImportOpen ? 'Close Add Multiple Requests' : 'Add Multiple Requests'}</span>
              </button>
            </div>

            {isQuickAddOpen && (
              <QuickAdd
                onAddRequest={handleAddRequest}
                duplicateError={duplicateError}
                onResolveDuplicate={handleResolveDuplicate}
                onCancelDuplicate={() => setDuplicateError(null)}
                isOpen={isQuickAddOpen}
                onToggle={() => setIsQuickAddOpen(false)}
                defaultCategory={activeCategory}
                onNotify={showToast}
                categoryDefinitions={categoryDefinitions}
                tagSuggestions={tagCatalog}
              />
            )}
            {isMultipleImportOpen && (
              <MultipleRequestsImport
                onImportBeatmapLinks={handleImportBeatmapLinks}
                onNotify={showToast}
                onToggle={() => setIsMultipleImportOpen(false)}
                defaultCategory={activeCategory}
                categoryDefinitions={categoryDefinitions}
              />
            )}
          </div>

          {/* Requests List */}
          <RequestsTable
            requestsList={requestsList}
            onOpenRequest={handleOpenRequest}
            onDeleteRequest={handleDeleteRequest}
            onUpdateRequest={handleUpdateRequest}
            onBulkUpdateStatus={handleBulkUpdateStatus}
            isBulkStatusUpdating={isBulkStatusUpdating}
            onBulkUpdatePriority={handleBulkUpdatePriority}
            onBulkUpdateCategory={handleBulkUpdateCategory}
            onBulkAddTags={handleBulkAddTags}
             onBulkDelete={handleBulkDelete}
             onRequestConfirmation={requestConfirmation}
            activeCategory={activeCategory}
            activeCategoryDefinition={activeCategoryDefinition}
            categoryDefinitions={categoryDefinitions}
            tagSuggestions={tagCatalog}
            sortBy={requestSort.sortBy}
            sortOrder={requestSort.sortOrder}
            onSortChange={(sortBy, sortOrder) => setRequestSort({ sortBy, sortOrder })}
          />
        </div>
      );
    }

    return null;
  };

  return (
    <div className="app-shell">
      <TopBar
        activeTab={activeTab}
        connectedAccount={settingsData.connectedAccount}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(open => !open)}
        categoryDefinitions={categoryDefinitions}
      />
      <div className="app-container">

        {/* LEFT SIDEBAR PANEL */}
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          connectedAccount={settingsData.connectedAccount}
          onDisconnect={handleDisconnect}
          isSidebarOpen={isSidebarOpen}
          categoryDefinitions={categoryDefinitions}
        />

        {/* RIGHT MAIN LAYOUT */}
        <main className="main-content">
          <div className="main-view">
            {renderMainView()}
          </div>
        </main>
      </div>

      {/* REQUEST DETAIL MODAL (Overlay) */}
      {selectedRequest && (
        <RequestDetailModal
          request={selectedRequest}
          onClose={() => setSelectedRequest(null)}
          onUpdateRequest={handleUpdateRequest}
          onForceRefreshBeatmap={fetchRequests}
          connectedAccount={settingsData.connectedAccount}
          onNotify={showToast}
          categoryDefinitions={categoryDefinitions}
          tagSuggestions={tagCatalog}
        />
      )}

      <Toast
        status={osuApiStatus}
        metadataSyncStatus={metadataSyncStatus}
        notification={toastNotice}
        onDismiss={dismissToast}
      />

      <ConfirmModal
        isOpen={Boolean(confirmationRequest)}
        {...confirmationRequest}
        onConfirm={() => finishConfirmation(true)}
        onCancel={() => finishConfirmation(false)}
      />

    </div>
  );
}
