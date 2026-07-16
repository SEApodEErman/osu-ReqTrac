import React from 'react';
import { Activity, ChevronRight, Menu, Minus, Square, X } from 'lucide-react';

function getSectionName(activeTab) {
  if (activeTab === 'dashboard') return 'Dashboard';
  if (activeTab === 'settings') return 'Settings';
  if (activeTab.startsWith('requests-')) {
    const category = activeTab.replace('requests-', '');
    return category === 'All' ? 'All Requests' : category;
  }
  return 'Workspace';
}

export default function TopBar({ activeTab, connectedAccount, isSidebarOpen, onToggleSidebar }) {
  const sectionName = getSectionName(activeTab);
  const controls = window.electronAPI?.windowControls;

  const toggleMaximize = () => {
    void controls?.toggleMaximize();
  };

  return (
    <header className="app-topbar">
      <div className="app-topbar-leading no-drag">
        <button
          type="button"
          className="app-sidebar-toggle"
          onClick={onToggleSidebar}
          title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          aria-label={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          aria-expanded={isSidebarOpen}
        >
          <Menu size={17} />
        </button>
      </div>

      <div className="app-topbar-drag-region" onDoubleClick={toggleMaximize}>
        <div className="app-topbar-title">
          <div className="app-topbar-brand">R</div>
          <span className="app-topbar-name">osu!ReqTrac</span>
          <ChevronRight size={14} className="app-topbar-chevron" />
          <span className="app-topbar-section">{sectionName}</span>
        </div>
      </div>

      <div className="app-topbar-status no-drag">
        <Activity size={14} />
        <span>{connectedAccount ? `Tracking ${connectedAccount.username}` : 'Workspace ready'}</span>
      </div>

      {controls && (
        <div className="app-window-controls no-drag">
          <button type="button" onClick={() => void controls.minimize()} title="Minimize"><Minus size={15} /></button>
          <button type="button" onClick={toggleMaximize} title="Maximize"><Square size={12} /></button>
          <button type="button" onClick={() => void controls.close()} title="Close" className="app-window-close"><X size={15} /></button>
        </div>
      )}
    </header>
  );
}
