'use client';

import React, { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import Dashboard from '../components/Dashboard';
import RequestsTable from '../components/RequestsTable';
import RequestDetailModal from '../components/RequestDetailModal';
import SettingsPanel from '../components/SettingsPanel';
import QuickAdd from '../components/QuickAdd';

export default function Home() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [theme, setTheme] = useState('dark');
  const [requestsList, setRequestsList] = useState([]);
  const [statsData, setStatsData] = useState({});
  const [settingsData, setSettingsData] = useState({});
  const [selectedRequest, setSelectedRequest] = useState(null);
  
  // QuickAdd duplicate check state
  const [duplicateError, setDuplicateError] = useState(null);

  // Load theme and initial data
  useEffect(() => {
    // Theme setup
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Initial API fetches
    fetchData();
  }, []);

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
      const res = await fetch('/api/requests');
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
      const res = await fetch('/api/stats');
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
      }
    } catch (e) {
      console.error('Error fetching settings:', e);
    }
  };

  const toggleTheme = (newTheme) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
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
        alert(`Failed to add request: ${errData.error || 'Server Error'}`);
      }
    } catch (e) {
      console.error(e);
      alert('Network Error. Failed to add request.');
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
        alert('Categories successfully added to the existing request!');
      } else {
        const errData = await res.json();
        alert(`Failed to resolve duplicate: ${errData.error}`);
      }
    } catch (e) {
      console.error(e);
      alert('Network Error.');
    }
  };

  // UPDATE Request
  const handleUpdateRequest = async (id, payload) => {
    try {
      const res = await fetch(`/api/requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        await Promise.all([fetchRequests(), fetchStats()]);
      } else {
        const errData = await res.json();
        alert(`Failed to update request: ${errData.error}`);
      }
    } catch (e) {
      console.error(e);
      alert('Network Error.');
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
        alert(`Failed to delete request: ${errData.error}`);
      }
    } catch (e) {
      console.error(e);
      alert('Network Error.');
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
      alert(`Successfully updated status to "${status}" for ${ids.length} requests.`);
    } catch (e) {
      console.error(e);
      alert('Failed to update status for some requests.');
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
      alert(`Successfully deleted ${ids.length} requests.`);
    } catch (e) {
      console.error(e);
      alert('Failed to delete some requests.');
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

  // Google Sheets CSV migration
  const handleImportCsv = async (csvText) => {
    try {
      const res = await fetch('/api/migration/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText })
      });

      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        await Promise.all([fetchRequests(), fetchStats()]);
        return true;
      } else {
        alert(`CSV Import Failed: ${data.error}`);
        return false;
      }
    } catch (e) {
      console.error(e);
      alert('CSV Import Network Error.');
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
        alert('Backup database successfully restored!');
        await fetchData();
        return true;
      } else {
        alert(`Database Restore Failed: ${data.error}`);
        return false;
      }
    } catch (e) {
      console.error(e);
      alert('Database Restore Network Error.');
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
        />
      );
    }

    if (activeTab === 'settings') {
      return (
        <SettingsPanel
          settingsData={settingsData}
          onSaveCredentials={handleSaveCredentials}
          onDisconnect={handleDisconnect}
          onImportCsv={handleImportCsv}
          onImportJson={handleImportJson}
        />
      );
    }

    if (activeTab.startsWith('requests-')) {
      const activeCategory = activeTab.replace('requests-', '');
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px 0 0 0' }}>
          
          {/* Quick Add Bar */}
          <div style={{ padding: '0 24px' }}>
            <QuickAdd
              onAddRequest={handleAddRequest}
              duplicateError={duplicateError}
              onResolveDuplicate={handleResolveDuplicate}
              onCancelDuplicate={() => setDuplicateError(null)}
            />
          </div>

          {/* Requests List */}
          <RequestsTable
            requestsList={requestsList}
            onOpenRequest={setSelectedRequest}
            onDeleteRequest={handleDeleteRequest}
            onUpdateRequest={handleUpdateRequest}
            onBulkUpdateStatus={handleBulkUpdateStatus}
            onBulkDelete={handleBulkDelete}
            activeCategory={activeCategory}
          />
        </div>
      );
    }

    return null;
  };

  return (
    <div className="app-container">
      
      {/* LEFT SIDEBAR PANEL */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        theme={theme}
        toggleTheme={toggleTheme}
        connectedAccount={settingsData.connectedAccount}
        onDisconnect={handleDisconnect}
      />

      {/* RIGHT MAIN LAYOUT */}
      <main className="main-content">
        {renderMainView()}
      </main>

      {/* REQUEST DETAIL MODAL (Overlay) */}
      {selectedRequest && (
        <RequestDetailModal
          request={selectedRequest}
          onClose={() => setSelectedRequest(null)}
          onUpdateRequest={handleUpdateRequest}
          onForceRefreshBeatmap={fetchRequests}
        />
      )}

    </div>
  );
}
