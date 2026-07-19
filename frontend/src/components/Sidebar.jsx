import React from 'react';
import appIcon from '../assets/app-icon.svg';
import { 
  LayoutDashboard, 
  ListTodo, 
  Settings, 
  Music, 
  Film, 
  HelpCircle,
  LogOut,
  UserCheck
} from 'lucide-react';

export default function Sidebar({ 
  activeTab, 
  setActiveTab, 
  connectedAccount,
  onDisconnect,
  isSidebarOpen = true,
  categoryDefinitions = [],
}) {
  const openConnectedProfile = async () => {
    if (!connectedAccount?.id) return;
    const profileUrl = `https://osu.ppy.sh/users/${connectedAccount.id}`;
    if (window.electronAPI?.openExternal) {
      await window.electronAPI.openExternal(profileUrl);
    } else {
      window.open(profileUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const iconBySystemKey = { hitsounds: Music, guest_difficulties: UserCheck, storyboards: Film, others: HelpCircle };
  const categories = [
    { id: 'all', name: 'All Requests', icon: ListTodo },
    ...categoryDefinitions.map(category => ({
      id: category.id,
      name: category.name,
      icon: iconBySystemKey[category.system_key] || ListTodo,
    })),
  ];

  return (
    <aside className={`sidebar ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      <div className="sidebar-panel">
      {/* Brand Header */}
      <div style={{ 
        padding: '24px 20px', 
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      }}>
        <img
          src={appIcon}
          alt=""
          aria-hidden="true"
          style={{
          width: '32px', 
          height: '32px', 
          borderRadius: '8px', 
          flexShrink: 0,
        }}
        />
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: '700', fontFamily: 'var(--font-display)', lineHeight: '1.2' }}>
            osu!ReqTrac
          </h2>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Personal Tracker
          </span>
        </div>
      </div>

      {/* Navigation List */}
      <nav style={{ padding: '20px 12px', flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {/* Dashboard Tab */}
        <button
          onClick={() => setActiveTab('dashboard')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            width: '100%',
            padding: '10px 12px',
            borderRadius: '8px',
            cursor: 'pointer',
            textAlign: 'left'
          }}
          className={`nav-item ${activeTab === 'dashboard' ? 'nav-item-active' : ''}`}
        >
          <LayoutDashboard size={18} />
          <span>Dashboard</span>
        </button>

        <div style={{ height: '1px', backgroundColor: 'var(--border)', margin: '10px 0' }} />
        
        {/* Categories Section Title */}
        <span style={{ 
          fontSize: '10px', 
          color: 'var(--text-muted)', 
          textTransform: 'uppercase', 
          letterSpacing: '1px', 
          paddingLeft: '12px', 
          marginBottom: '6px',
          display: 'block',
          fontWeight: '600'
        }}>
          Categories
        </span>

        {categories.map((cat) => {
          const Icon = cat.icon;
          const isSelected = activeTab === `requests-${cat.id}`;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveTab(`requests-${cat.id}`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                cursor: 'pointer',
                textAlign: 'left'
              }}
              className={`nav-item ${isSelected ? 'nav-item-active' : ''}`}
            >
              <Icon size={18} />
              <span>{cat.name}</span>
            </button>
          );
        })}

        <div style={{ height: '1px', backgroundColor: 'var(--border)', margin: '10px 0' }} />

        {/* Settings Tab */}
        <button
          onClick={() => setActiveTab('settings')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            width: '100%',
            padding: '10px 12px',
            borderRadius: '8px',
            cursor: 'pointer',
            textAlign: 'left'
          }}
          className={`nav-item ${activeTab === 'settings' ? 'nav-item-active' : ''}`}
        >
          <Settings size={18} />
          <span>Settings</span>
        </button>
      </nav>

      {/* Connected Account footer */}
      <div style={{ 
        padding: '16px', 
        borderTop: '1px solid var(--border)',
      }}>
        {/* Connected Profile */}
        {connectedAccount ? (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            padding: '8px',
            backgroundColor: 'var(--bg-card)',
            borderRadius: '8px',
            border: '1px solid var(--border)'
          }}>
            <button
              type="button"
              onClick={openConnectedProfile}
              disabled={!connectedAccount.id}
              title={connectedAccount.id ? 'Open osu! profile' : 'No osu! user ID configured'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: 0,
                border: 0,
                background: 'transparent',
                color: 'inherit',
                cursor: connectedAccount.id ? 'pointer' : 'default',
                textAlign: 'left'
              }}
            >
              <img
                src={connectedAccount.avatar || '/uploads/covers/default.jpg'} 
                alt={connectedAccount.username} 
                width={28}
                height={28}
                style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
              />
              <div style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', lineHeight: '1.2' }}>
                  {connectedAccount.username}
                </div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>osu! Profile</div>
              </div>
            </button>
            <button 
              onClick={onDisconnect}
              title="Disconnect Account"
              style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--priority-high)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', padding: '4px' }}>
            osu! API disconnected
          </div>
        )}
      </div>
      </div>
    </aside>
  );
}
