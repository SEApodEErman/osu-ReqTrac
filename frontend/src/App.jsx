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

function getResolvedTheme(preference) {
  if (preference !== 'system') return preference;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const API_REQUEST_TIMEOUT_MS = 30000;

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
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isMultipleImportOpen, setIsMultipleImportOpen] = useState(false);
  const [showFirstLaunchSetup, setShowFirstLaunchSetup] = useState(false);
  const [osuApiStatus, setOsuApiStatus] = useState(null);
  const [toastNotice, setToastNotice] = useState(null);
  const toastIdRef = useRef(0);

  // QuickAdd duplicate check state
  const [duplicateError, setDuplicateError] = useState(null);

  const showToast = useCallback((message, type = 'info', action = null) => {
    setToastNotice({ id: ++toastIdRef.current, message, type, action });
    if ((type === 'error' || type === 'warning') && window.electronAPI?.windowControls?.flashFrame) {
      void window.electronAPI.windowControls.flashFrame();
    }
  }, []);

  const dismissToast = useCallback(() => setToastNotice(null), []);

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
        fetchSettings()
      ]);
    } catch (e) {
      console.error('Failed to load initial data:', e);
    }
  };

  const fetchRequests = async () => {
    try {
      const res = await fetchWithTimeout('/api/requests');
      if (res.ok) {
        const data = await res.json();
        setRequestsList(data);

        // Keep detail modal updated if open
        if (selectedRequest) {
          const updated = data.find(r => r.id === selectedRequest.id);
          if (updated) {
            setSelectedRequest(updated);
          }
        }
      }
    } catch (e) {
      console.error('Error fetching requests list:', e);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetchWithTimeout('/api/stats');
      if (res.ok) {
        const data = await res.json();
        setStatsData(data);
      }
    } catch (e) {
      console.error('Error fetching stats:', e);
    }
  };

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
    ]).catch((error) => {
      console.error('Failed to load initial data:', error);
    });
  }, []);

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
        return;
      }

      if (res.ok) {
        await Promise.all([fetchRequests(), fetchStats()]);
        if (callback) callback();
      } else {
        const errData = await res.json();
        showToast(`Failed to add request: ${errData.error || 'Server Error'}`, 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Network Error. Failed to add request.', 'error');
    }
  };

  // Resolve duplicate by adding categories to existing request
  const handleResolveDuplicate = async (requestId, categories, callback) => {
    setDuplicateError(null);
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
        await Promise.all([fetchRequests(), fetchStats()]);
        if (callback) callback();
        showToast('Categories successfully added to the existing request!', 'success');
      } else {
        const errData = await res.json();
        showToast(`Failed to resolve duplicate: ${errData.error}`, 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Network Error.', 'error');
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
        await Promise.all([fetchRequests(), fetchStats()]);
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
    try {
      await Promise.all(
        ids.map(id =>
          fetch(`/api/requests/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ request_status: status })
          })
        )
      );
      await Promise.all([fetchRequests(), fetchStats()]);
      showToast(`Successfully updated status to "${status}" for ${ids.length} requests.`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to update status for some requests.', 'error');
    }
  };

  // Bulk priority update
  const handleBulkUpdatePriority = async (ids, priority) => {
    try {
      await Promise.all(
        ids.map(id =>
          fetch(`/api/requests/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ priority })
          })
        )
      );
      await Promise.all([fetchRequests(), fetchStats()]);
      showToast(`Successfully updated priority to "${priority}" for ${ids.length} requests.`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to update priority for some requests.', 'error');
    }
  };

  // Bulk category/type update
  const handleBulkUpdateCategory = async (ids, categoryName, mode) => {
    try {
      const requestsById = new Map(requestsList.map(request => [request.id, request]));
      const responses = await Promise.all(ids.map(id => {
        const request = requestsById.get(id);
        if (!request) throw new Error(`Request ${id} was not found`);

        const currentCategories = Array.isArray(request.categories) ? request.categories : [];
        const nextCategories = mode === 'move'
          ? [{ category_name: categoryName, status: 'Pending' }]
          : currentCategories.some(category => category.category_name === categoryName)
            ? currentCategories
            : [...currentCategories, { category_name: categoryName, status: 'Pending' }];

        return fetch(`/api/requests/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categories: nextCategories })
        });
      }));

      if (responses.some(response => !response.ok)) {
        throw new Error('One or more category updates failed');
      }

      await Promise.all([fetchRequests(), fetchStats()]);
      showToast(`${mode === 'move' ? 'Moved' : 'Added'} ${ids.length} requests ${mode === 'move' ? 'to' : 'into'} "${categoryName}".`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to update request types for some requests.', 'error');
    }
  };

  // Bulk delete
  const handleBulkDelete = async (ids) => {
    try {
      await Promise.all(
        ids.map(id =>
          fetch(`/api/requests/${id}`, { method: 'DELETE' })
        )
      );
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
    if (confirm('Disconnect connected osu! account?')) {
      const res = await fetch('/api/settings/disconnect', { method: 'POST' });
      if (res.ok) {
        await fetchSettings();
      }
    }
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
        showToast(data.message, 'success');
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

  // Render correct main view
  const renderMainView = () => {
    if (activeTab === 'dashboard') {
      return (
        <Dashboard
          statsData={statsData}
          requestsList={requestsList}
          onOpenRequest={setSelectedRequest}
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
           onImportJson={handleImportJson}
          onNotify={showToast}
        />
      );
    }

    if (activeTab.startsWith('requests-')) {
      const activeCategory = activeTab.replace('requests-', '');
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
              />
            )}
            {isMultipleImportOpen && (
              <MultipleRequestsImport
                onImportBeatmapLinks={handleImportBeatmapLinks}
                onNotify={showToast}
                onToggle={() => setIsMultipleImportOpen(false)}
                defaultCategory={activeCategory}
              />
            )}
          </div>

          {/* Requests List */}
          <RequestsTable
            requestsList={requestsList}
            onOpenRequest={setSelectedRequest}
            onDeleteRequest={handleDeleteRequest}
            onUpdateRequest={handleUpdateRequest}
            onBulkUpdateStatus={handleBulkUpdateStatus}
            onBulkUpdatePriority={handleBulkUpdatePriority}
            onBulkUpdateCategory={handleBulkUpdateCategory}
            onBulkDelete={handleBulkDelete}
            activeCategory={activeCategory}
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
      />
      <div className="app-container">

        {/* LEFT SIDEBAR PANEL */}
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          connectedAccount={settingsData.connectedAccount}
          onDisconnect={handleDisconnect}
          isSidebarOpen={isSidebarOpen}
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
        />
      )}

      <Toast status={osuApiStatus} notification={toastNotice} onDismiss={dismissToast} />

    </div>
  );
}
