'use client';

import React from 'react';
import { 
  LayoutDashboard, 
  ListTodo, 
  Settings, 
  Moon, 
  Sun, 
  Music, 
  Layers, 
  Film, 
  HelpCircle,
  LogOut,
  UserCheck
} from 'lucide-react';

export default function Sidebar({ 
  activeTab, 
  setActiveTab, 
  theme, 
  toggleTheme, 
  connectedAccount,
  onDisconnect
}) {
  const categories = [
    { id: 'All', name: 'All Requests', icon: ListTodo },
    { id: 'Hitsounds', name: 'Hitsounds', icon: Music },
    { id: 'Guest Difficulties', name: 'Guest Difficulties', icon: UserCheck },
    { id: 'Storyboards', name: 'Storyboards', icon: Film },
    { id: 'Others', name: 'Others', icon: HelpCircle },
  ];

  return (
    <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Brand Header */}
      <div style={{ 
        padding: '24px 20px', 
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      }}>
        <div style={{ 
          width: '32px', 
          height: '32px', 
          borderRadius: '8px', 
          backgroundColor: 'var(--osu-pink)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontWeight: '800',
          fontFamily: 'var(--font-display)',
          fontSize: '18px',
          boxShadow: '0 2px 8px rgba(255, 102, 170, 0.4)'
        }}>
          R
        </div>
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
            backgroundColor: activeTab === 'dashboard' ? 'var(--hover-bg)' : 'transparent',
            color: activeTab === 'dashboard' ? 'var(--osu-pink)' : 'var(--text-main)',
            fontWeight: activeTab === 'dashboard' ? '600' : '500',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.2s'
          }}
          className="nav-item"
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
                backgroundColor: isSelected ? 'var(--hover-bg)' : 'transparent',
                color: isSelected ? 'var(--osu-pink)' : 'var(--text-main)',
                fontWeight: isSelected ? '600' : '500',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s'
              }}
              className="nav-item"
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
            backgroundColor: activeTab === 'settings' ? 'var(--hover-bg)' : 'transparent',
            color: activeTab === 'settings' ? 'var(--osu-pink)' : 'var(--text-main)',
            fontWeight: activeTab === 'settings' ? '600' : '500',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.2s'
          }}
          className="nav-item"
        >
          <Settings size={18} />
          <span>Settings</span>
        </button>
      </nav>

      {/* Connected Account & Theme Toggle footer */}
      <div style={{ 
        padding: '16px', 
        borderTop: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <img 
                src={connectedAccount.avatar || '/uploads/covers/default.jpg'} 
                alt={connectedAccount.username} 
                style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
              />
              <div style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', lineHeight: '1.2' }}>
                  {connectedAccount.username}
                </div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>osu! Profile</div>
              </div>
            </div>
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

        {/* Theme Selector */}
        <div style={{ 
          display: 'flex', 
          backgroundColor: 'var(--bg-app)', 
          borderRadius: '8px', 
          padding: '2px',
          border: '1px solid var(--border)'
        }}>
          <button
            onClick={() => toggleTheme('dark')}
            style={{
              flexGrow: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '6px 0',
              borderRadius: '6px',
              backgroundColor: theme === 'dark' ? 'var(--bg-card)' : 'transparent',
              color: theme === 'dark' ? 'var(--osu-pink)' : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <Moon size={14} style={{ marginRight: '6px' }} />
            <span style={{ fontSize: '11px', fontWeight: '600' }}>Dark</span>
          </button>
          <button
            onClick={() => toggleTheme('light')}
            style={{
              flexGrow: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '6px 0',
              borderRadius: '6px',
              backgroundColor: theme === 'light' ? 'var(--bg-card)' : 'transparent',
              color: theme === 'light' ? 'var(--osu-pink)' : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <Sun size={14} style={{ marginRight: '6px' }} />
            <span style={{ fontSize: '11px', fontWeight: '600' }}>Light</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
