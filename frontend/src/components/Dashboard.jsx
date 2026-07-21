import React from 'react';
import { countryCodeToFlag } from '../utils/countryFlag';
import { getRecentDashboardRequests } from '../utils/dashboard';
import { 
  FileText, 
  Play, 
  CheckCircle, 
  AlertTriangle, 
  Clock, 
  Award, 
  User, 
  Flame,
  Calendar
} from 'lucide-react';

export default function Dashboard({
  statsData,
  statsLoading = false,
  requestsList,
  onOpenRequest,
  connectedAccount,
  categoryDefinitions = [],
  selectedCategoryId = 'all',
  onCategoryChange,
}) {
  const displayedStats = statsLoading ? {} : statsData;
  const { overview = {}, stats = {}, yearSummary = [], requesterBreakdown = [] } = displayedStats || {};
  const connectedUsername = connectedAccount?.username || null;

  // Exclude the connected user from the breakdown (dashboard is for their own use)
  const filteredBreakdown = connectedUsername
    ? requesterBreakdown.filter(r => r.username !== connectedUsername)
    : requesterBreakdown;

  // Determine top requester excluding the connected user (fallback to next in line)
  const nextTopRequester = filteredBreakdown.length > 0 ? filteredBreakdown[0].username : 'None';
  const displayTopRequester = (connectedUsername && stats.mostFrequentRequester === connectedUsername)
    ? nextTopRequester
    : (stats.mostFrequentRequester || 'None');

  const maxRequesterCount = filteredBreakdown.length > 0
    ? Math.max(...filteredBreakdown.map(r => r.count))
    : 1;
  
  // Scope recent requests to the same category as the dashboard statistics.
  const recentlyAdded = getRecentDashboardRequests(requestsList, selectedCategoryId);

  // SVG Chart Calculation
  const maxCompleted = yearSummary.length > 0 
    ? Math.max(...yearSummary.map(y => y.completedCount)) 
    : 10;
  
  const chartHeight = 120;
  const chartWidth = 320;
  const barPadding = 16;
  const barWidth = yearSummary.length > 0 
    ? (chartWidth - (barPadding * (yearSummary.length + 1))) / yearSummary.length 
    : 40;

  return (
    <div
      aria-busy={statsLoading}
      style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}
    >
      
      {/* Welcome Header */}
      <div className="dashboard-header">
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', fontFamily: 'var(--font-display)', marginBottom: '4px' }}>
            Overview
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Welcome back! Here is a summary of your osu! request tracking workspace.
          </p>
        </div>
        <label className="dashboard-category-control">
          <span>Category</span>
          <select
            className="input-text dashboard-category-select"
            value={selectedCategoryId}
            onChange={event => onCategoryChange?.(event.target.value)}
            aria-label="Dashboard statistics category"
          >
            <option value="all">All</option>
            {categoryDefinitions.map(category => (
              <option key={category.id} value={String(category.id)}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {statsLoading && (
        <div className="dashboard-loading" role="status">Loading category statistics…</div>
      )}

      {/* Grid of 4 Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px'
      }}>
        {/* Card 1: Total */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ 
            backgroundColor: 'var(--hover-bg)', 
            color: 'var(--text-main)', 
            padding: '12px', 
            borderRadius: '10px' 
          }}>
            <FileText size={22} />
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
              Total Requests
            </div>
            <div style={{ fontSize: '24px', fontWeight: '700', fontFamily: 'var(--font-display)' }}>
              {overview.total || 0}
            </div>
          </div>
        </div>

        {/* Card 2: Active */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ 
            backgroundColor: 'rgba(52, 152, 219, 0.1)', 
            color: 'var(--req-working)', 
            padding: '12px', 
            borderRadius: '10px' 
          }}>
            <Play size={22} />
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
              Active
            </div>
            <div style={{ fontSize: '24px', fontWeight: '700', fontFamily: 'var(--font-display)', color: 'var(--req-working)' }}>
              {overview.active || 0}
            </div>
          </div>
        </div>

        {/* Card 3: Completed */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ 
            backgroundColor: 'rgba(46, 204, 113, 0.1)', 
            color: 'var(--req-completed)', 
            padding: '12px', 
            borderRadius: '10px' 
          }}>
            <CheckCircle size={22} />
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
              Completed
            </div>
            <div style={{ fontSize: '24px', fontWeight: '700', fontFamily: 'var(--font-display)', color: 'var(--req-completed)' }}>
              {overview.completed || 0}
            </div>
          </div>
        </div>

        {/* Card 4: Due within week */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ 
            backgroundColor: 'rgba(231, 76, 60, 0.1)', 
            color: 'var(--req-cancelled)', 
            padding: '12px', 
            borderRadius: '10px' 
          }}>
            <AlertTriangle size={22} />
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
              Due This Week
            </div>
            <div style={{ fontSize: '24px', fontWeight: '700', fontFamily: 'var(--font-display)', color: overview.dueSoon > 0 ? 'var(--req-cancelled)' : 'var(--text-muted)' }}>
              {overview.dueSoon || 0}
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Recently Added vs Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.2fr 0.8fr',
        gap: '24px'
      }}>
        {/* Left Side: Recently Added */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '700' }}>Recently Added</h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Newest requests</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {recentlyAdded.length === 0 ? (
              <div style={{ 
                padding: '32px', 
                textAlign: 'center', 
                color: 'var(--text-muted)',
                backgroundColor: 'var(--bg-app)',
                borderRadius: '8px',
                border: '1px dashed var(--border)'
              }}>
                No requests found. Paste an osu! link in the Requests panel to get started!
              </div>
            ) : (
              recentlyAdded.map(req => (
                <div 
                  key={req.id} 
                  onClick={() => onOpenRequest(req)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-app)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  className="recent-req-item"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--osu-pink)';
                    e.currentTarget.style.transform = 'translateX(4px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.transform = 'translateX(0)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <img
                      src={req.local_cover_path} 
                      alt="cover" 
                      width={48}
                      height={28}
                      style={{ 
                        width: '48px', 
                        height: '28px', 
                        borderRadius: '4px', 
                        objectFit: 'cover',
                        border: '1px solid var(--border)'
                      }}
                      onError={(e) => {
                        e.target.src = '/uploads/covers/default.jpg';
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ 
                        fontSize: '13px', 
                        fontWeight: '600', 
                        whiteSpace: 'nowrap', 
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis',
                        color: 'var(--text-main)'
                      }}>
                        {req.artist} - {req.title}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Mapped by {req.creator} • Requester: {req.requester_username}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {req.deadline && (
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Calendar size={12} />
                        {new Date(req.deadline).toLocaleDateString()}
                      </span>
                    )}
                    <span className={`badge badge-${req.request_status.toLowerCase()}`}>
                      {req.request_status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Side: Statistics Summary */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700' }}>Statistics</h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Stat: Completed count */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
                <CheckCircle size={16} />
                <span>Completed Requests</span>
              </div>
              <span style={{ fontWeight: '700' }}>{stats.completedCount || 0}</span>
            </div>

            {/* Stat: Drain time */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
                <Clock size={16} />
                <span>Drain Time Worked</span>
              </div>
              <span style={{ fontWeight: '700' }}>{stats.totalDrainTime || '0 hours'}</span>
            </div>

            {/* Stat: Ranked maps */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
                <Award size={16} style={{ color: 'var(--status-ranked)' }} />
                <span>Ranked Completed</span>
              </div>
              <span style={{ fontWeight: '700', color: 'var(--status-ranked)' }}>{stats.rankedCompletedCount || 0}</span>
            </div>

            {/* Stat: Most frequent requester */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
                <User size={16} />
                <span>Top Requester</span>
              </div>
              <span style={{ fontWeight: '700', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayTopRequester}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Grid: Year Summary and Year SVG Chart */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '24px'
      }}>
        {/* Year Table */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700' }}>Yearly Breakdown</h3>

          {yearSummary.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              No yearly records yet. Completing requests will populate this summary.
            </div>
          ) : (
            <div className="table-container" style={{ border: 'none' }}>
              <table className="compact-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ backgroundColor: 'transparent', paddingLeft: 0 }}>Year</th>
                    <th style={{ backgroundColor: 'transparent' }}>Completed</th>
                    <th style={{ backgroundColor: 'transparent' }}>Drain Time</th>
                    <th style={{ backgroundColor: 'transparent', paddingRight: 0 }}>Top User</th>
                  </tr>
                </thead>
                <tbody>
                  {yearSummary.map(y => (
                    <tr key={y.year} style={{ cursor: 'default', backgroundColor: 'transparent' }}>
                      <td style={{ fontWeight: '600', paddingLeft: 0 }}>{y.year}</td>
                      <td>{y.completedCount} requests</td>
                      <td>{y.totalDrainTime}</td>
                      <td style={{ paddingRight: 0 }}>{connectedUsername && y.mostRequestedUser === connectedUsername ? nextTopRequester : y.mostRequestedUser}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Year Chart */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700' }}>Year Completed Summary</h3>

          {yearSummary.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              No data to chart.
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', height: '140px', paddingBottom: '10px' }}>
              <svg width={chartWidth} height={chartHeight} style={{ overflow: 'visible' }}>
                {/* Chart grid lines */}
                <line x1={0} y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="var(--border)" strokeWidth={1} />
                <line x1={0} y1={chartHeight / 2} x2={chartWidth} y2={chartHeight / 2} stroke="var(--border)" strokeWidth={1} strokeDasharray="4 4" />
                <line x1={0} y1={0} x2={chartWidth} y2={0} stroke="var(--border)" strokeWidth={1} strokeDasharray="4 4" />

                {yearSummary.map((y, index) => {
                  const barX = barPadding + index * (barWidth + barPadding);
                  const barValHeight = (y.completedCount / maxCompleted) * (chartHeight - 20); // leave 20px gap for label
                  const barY = chartHeight - barValHeight;
                  
                  return (
                    <g key={y.year}>
                      {/* Bar shadow/hover handle */}
                      <rect 
                        x={barX} 
                        y={0} 
                        width={barWidth} 
                        height={chartHeight} 
                        fill="transparent" 
                        style={{ cursor: 'pointer' }}
                      />
                      {/* Bar Fill */}
                      <rect 
                        x={barX} 
                        y={barY} 
                        width={barWidth} 
                        height={barValHeight} 
                        fill="var(--osu-pink)" 
                        rx={4}
                        style={{ transition: 'all 0.3s' }}
                      />
                      {/* Value label */}
                      <text 
                        x={barX + barWidth / 2} 
                        y={barY - 6} 
                        fill="var(--text-main)" 
                        fontSize={10} 
                        fontWeight={700}
                        textAnchor="middle"
                      >
                        {y.completedCount}
                      </text>
                      {/* Year label */}
                      <text 
                        x={barX + barWidth / 2} 
                        y={chartHeight + 14} 
                        fill="var(--text-muted)" 
                        fontSize={10} 
                        fontWeight={500}
                        textAnchor="middle"
                      >
                        {y.year}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Requester Breakdown */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <User size={16} />
            Requester Breakdown
          </h3>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Top requesters by request count</span>
        </div>

        {filteredBreakdown.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No requester data yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredBreakdown.map((r, index) => (
              <div key={r.username + index} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <img
                  src={r.avatar_url || '/uploads/covers/default.jpg'}
                  alt={r.username}
                  width={32}
                  height={32}
                  style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }}
                  onError={(e) => { e.target.src = '/uploads/covers/default.jpg'; }}
                />
                <div style={{ flexGrow: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.country_code && (
                        <span
                          title={r.country_code.toUpperCase()}
                          aria-label={`Country: ${r.country_code.toUpperCase()}`}
                          className="country-flag"
                          style={{ marginRight: '6px' }}
                        >
                          {countryCodeToFlag(r.country_code)}
                        </span>
                      )}
                      {r.username}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--osu-pink)', flexShrink: 0, marginLeft: '8px' }}>
                      {r.count}
                    </span>
                  </div>
                  <div style={{ height: '6px', backgroundColor: 'var(--bg-app)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${(r.count / maxRequesterCount) * 100}%`,
                      backgroundColor: 'var(--osu-pink)',
                      borderRadius: '3px',
                      transition: 'width 0.3s'
                    }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
