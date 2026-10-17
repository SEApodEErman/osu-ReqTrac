import React from 'react';
import { Film, HelpCircle, LayoutDashboard, ListTodo, Music, Settings, Tag, UserCheck } from 'lucide-react';
import Avatar from './ui/Avatar';

const ICON_BY_SYSTEM_KEY = { hitsounds: Music, guest_difficulties: UserCheck, storyboards: Film, others: HelpCircle };

function NavItem({ icon: Icon, label, count, isActive, onClick, title }) {
  return (
    <button
      type="button"
      className="nav-item"
      aria-current={isActive ? 'page' : undefined}
      onClick={onClick}
      title={title || label}
    >
      <Icon size={17} />
      <span className="nav-item-label">{label}</span>
      {count > 0 && <span className="count-badge" aria-label={`${count} active`}>{count}</span>}
    </button>
  );
}

export default function Sidebar({
  activeView,
  onNavigate,
  categories = [],
  activeCounts = {},
  connectedAccount,
  isConfigured,
  isCollapsed,
}) {
  let accountStatus = { tone: 'ok', text: 'osu! API connected' };
  if (!isConfigured) accountStatus = { tone: 'warning', text: 'Set up the osu! API' };
  else if (!connectedAccount) accountStatus = { tone: 'warning', text: 'Add your osu! account' };

  return (
    <aside className={`sidebar${isCollapsed ? ' is-collapsed' : ''}`} aria-label="Main navigation">
      <nav className="sidebar-nav">
        <NavItem icon={LayoutDashboard} label="Overview" isActive={activeView === 'overview'} onClick={() => onNavigate('overview')} title="Overview (Ctrl+1)" />

        <div className="sidebar-section-label"><span>Requests</span></div>
        <NavItem
          icon={ListTodo}
          label="All requests"
          count={activeCounts.all}
          isActive={activeView === 'requests-all'}
          onClick={() => onNavigate('requests-all')}
          title="All requests (Ctrl+2)"
        />
        {categories.map(category => (
          <NavItem
            key={category.id}
            icon={ICON_BY_SYSTEM_KEY[category.system_key] || Tag}
            label={category.name}
            count={activeCounts[category.id]}
            isActive={activeView === `requests-${category.id}`}
            onClick={() => onNavigate(`requests-${category.id}`)}
          />
        ))}

        <div className="sidebar-section-label"><span>App</span></div>
        <NavItem icon={Settings} label="Settings" isActive={activeView === 'settings'} onClick={() => onNavigate('settings')} title="Settings (Ctrl+,)" />
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="sidebar-account" onClick={() => onNavigate('settings', 'osu')} title={accountStatus.text}>
          <Avatar src={connectedAccount?.avatar} name={connectedAccount?.username || 'osu!'} />
          <span className="sidebar-account-text">
            <span className="sidebar-account-name">{connectedAccount?.username || 'No account added'}</span>
            <span className="sidebar-account-status" data-tone={accountStatus.tone}>
              <span className="status-dot" />
              {accountStatus.text}
            </span>
          </span>
        </button>
      </div>
    </aside>
  );
}
