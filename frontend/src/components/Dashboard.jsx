import React, { useMemo } from 'react';
import { ArrowRight, Calendar, FileSpreadsheet, KeyRound, ListPlus, Plus } from 'lucide-react';
import { countryCodeToFlag } from '../utils/countryFlag';
import { buildAttentionGroups } from '../utils/attention';
import { describeDeadline, compareAppDates, formatRelativeTime } from '../utils/dates';
import { requestBelongsToDashboardCategory, getRecentDashboardRequests } from '../utils/dashboard';
import { PRIORITY_SORT_ORDER, requestDisplayTitle } from '../utils/requestConstants';
import { StatusPill } from './ui/Badges';
import Avatar from './ui/Avatar';
import CoverImage, { coverBackground } from './ui/CoverImage';

const ATTENTION_PREVIEW = 4;

function pickNowWorking(requests) {
  const working = requests.filter(request => request.request_status === 'Working');
  const pool = working.length ? working : requests.filter(request => request.request_status === 'Accepted');
  return [...pool].sort((a, b) => (
    compareAppDates(a.deadline, b.deadline)
    || PRIORITY_SORT_ORDER.indexOf(a.priority || 'Low') - PRIORITY_SORT_ORDER.indexOf(b.priority || 'Low')
    || compareAppDates(b.last_updated, a.last_updated)
  ))[0] || null;
}

function DeadlineText({ request }) {
  const deadline = describeDeadline(request.deadline, request.request_status);
  if (!deadline) return null;
  return (
    <span className={`deadline-text deadline-${deadline.tone}`}>
      <Calendar size={12} />
      {deadline.text}
    </span>
  );
}

function RequestListItem({ request, onOpen, aside }) {
  return (
    <button type="button" className="request-list-item" onClick={() => onOpen(request)}>
      <CoverImage src={request.local_cover_path} className="request-list-cover" />
      <span style={{ minWidth: 0 }}>
        <div className="request-list-title">{requestDisplayTitle(request)}</div>
        <div className="request-list-meta">
          {[request.artist, request.creator && `mapped by ${request.creator}`, request.requester_username && !['anonymous', String(request.creator || '').toLowerCase()].includes(request.requester_username.toLowerCase()) && `for ${request.requester_username}`].filter(Boolean).join(' · ')}
        </div>
      </span>
      <span className="request-list-aside">{aside ?? <StatusPill status={request.request_status} />}</span>
    </button>
  );
}

function ActivityChart({ months = [] }) {
  const width = 560;
  const height = 150;
  const top = 12;
  const bottom = 22;
  const max = Math.max(1, ...months.flatMap(month => [month.added, month.completed]));
  const slot = width / Math.max(months.length, 1);
  const barWidth = Math.min(14, slot / 3);
  const y = value => top + (height - top - bottom) * (1 - value / max);
  const label = month => new Date(Number(month.month.slice(0, 4)), Number(month.month.slice(5, 7)) - 1, 1).toLocaleDateString(undefined, { month: 'short' });
  const totalAdded = months.reduce((sum, month) => sum + month.added, 0);
  const totalCompleted = months.reduce((sum, month) => sum + month.completed, 0);

  return (
    <div>
      <div className="chart-legend" style={{ marginBottom: 8 }}>
        <span><i style={{ background: 'var(--border-strong)' }} />Added · {totalAdded}</span>
        <span><i style={{ background: 'var(--accent)' }} />Completed · {totalCompleted}</span>
      </div>
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Requests added and completed per month over the last 12 months: ${totalAdded} added, ${totalCompleted} completed.`}>
        {[0.5, 1].map(fraction => (
          <line key={fraction} className="chart-grid" x1={0} x2={width} y1={y(max * fraction)} y2={y(max * fraction)} />
        ))}
        <text className="chart-axis" x={0} y={y(max) - 3}>{max}</text>
        {months.map((month, index) => {
          const center = slot * index + slot / 2;
          return (
            <g key={month.month}>
              <title>{`${label(month)} ${month.month.slice(0, 4)}: ${month.added} added, ${month.completed} completed`}</title>
              <rect x={center - barWidth - 1} y={y(month.added)} width={barWidth} height={Math.max(0, height - bottom - y(month.added))} rx={3} fill="var(--border-strong)" />
              <rect x={center + 1} y={y(month.completed)} width={barWidth} height={Math.max(0, height - bottom - y(month.completed))} rx={3} fill="var(--accent)" />
              <text className="chart-axis" x={center} y={height - 6} textAnchor="middle">{label(month)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function OnboardingEmptyState({ isConfigured, onAddRequest, onImport, onOpenSetup }) {
  return (
    <div className="panel">
      <div className="empty-state">
        <span className="empty-state-icon"><ListPlus size={22} /></span>
        <h3>Track your first request</h3>
        <p>
          Paste an osu! beatmap link and ReqTrac fills in the title, mapper, difficulties, and cover for you.
          Already keep a list somewhere? Import it from a spreadsheet or a list of links.
        </p>
        <div className="view-actions">
          {!isConfigured && (
            <button type="button" className="btn btn-primary" onClick={onOpenSetup}><KeyRound size={15} />Connect osu! first</button>
          )}
          <button type="button" className={isConfigured ? 'btn btn-primary' : 'btn btn-secondary'} onClick={onAddRequest}><Plus size={15} />Add request</button>
          <button type="button" className="btn btn-secondary" onClick={onImport}><FileSpreadsheet size={15} />Import requests</button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({
  stats,
  statsLoading,
  requests,
  requestsLoaded,
  categories,
  selectedCategoryId,
  onCategoryChange,
  onOpenRequest,
  onShowRequests,
  onAddRequest,
  onImport,
  onOpenSetup,
  isConfigured,
}) {
  const scopedRequests = useMemo(
    () => requests.filter(request => requestBelongsToDashboardCategory(request, selectedCategoryId)),
    [requests, selectedCategoryId],
  );
  const attentionGroups = useMemo(() => buildAttentionGroups(scopedRequests), [scopedRequests]);
  const nowWorking = useMemo(() => pickNowWorking(scopedRequests), [scopedRequests]);
  const recentlyAdded = useMemo(() => getRecentDashboardRequests(requests, selectedCategoryId, 5), [requests, selectedCategoryId]);
  const categoryKey = selectedCategoryId === 'all' ? 'all' : selectedCategoryId;
  const overview = stats?.overview || {};
  const summary = stats?.stats || {};
  const requesters = stats?.requesterBreakdown || [];
  const maxRequesterCount = Math.max(1, ...requesters.map(requester => requester.count));
  const loadingValue = value => (statsLoading && !stats ? '–' : value ?? 0);

  const kpis = [
    { label: 'Active', value: overview.active, tone: 'working', foot: 'Considering, accepted, or working', filter: { status: 'active' } },
    { label: 'Overdue', value: overview.overdue, tone: overview.overdue ? 'overdue' : undefined, foot: 'Due today or earlier', filter: { due: 'overdue' } },
    { label: 'Due this week', value: overview.dueSoon, tone: overview.dueSoon ? 'soon' : undefined, foot: 'In the next 7 days', filter: { due: 'week' } },
    { label: 'Completed', value: overview.completed, tone: 'done', foot: `${summary.totalDrainTime || '0 hours'} of drain time`, filter: { status: 'Completed' } },
    { label: 'All requests', value: overview.total, foot: `${summary.rankedCompletedCount || 0} completed maps ranked`, filter: {} },
  ];

  const isEmptyLibrary = requestsLoaded && requests.length === 0;

  return (
    <div className="view">
      <div className="view-inner">
        <div className="view-header">
          <div>
            <h1 className="view-title">Overview</h1>
            <p className="view-subtitle">What needs your attention, and how your requests are going.</p>
          </div>
          <div className="view-actions">
            <select
              className="input"
              style={{ width: 'auto', minWidth: 170 }}
              value={selectedCategoryId}
              onChange={event => onCategoryChange(event.target.value)}
              aria-label="Show statistics for"
            >
              <option value="all">All categories</option>
              {categories.map(category => <option key={category.id} value={String(category.id)}>{category.name}</option>)}
            </select>
            <button type="button" className="btn btn-primary" onClick={onAddRequest} title="Add request (Ctrl+N)">
              <Plus size={15} />Add request
            </button>
          </div>
        </div>

        {isEmptyLibrary ? (
          <OnboardingEmptyState isConfigured={isConfigured} onAddRequest={onAddRequest} onImport={onImport} onOpenSetup={onOpenSetup} />
        ) : (
          <>
            {nowWorking && (
              <section className="now-working" aria-label="Up next">
                <div className="now-working-cover" style={coverBackground(nowWorking.local_cover_path)} />
                <div className="now-working-content">
                  <div style={{ minWidth: 0 }}>
                    <div className="now-working-eyebrow">{nowWorking.request_status === 'Working' ? 'You’re working on' : 'Up next'}</div>
                    <h2 className="now-working-title">{requestDisplayTitle(nowWorking)}</h2>
                    <div className="now-working-meta">
                      {[nowWorking.artist, nowWorking.creator && `mapped by ${nowWorking.creator}`, (nowWorking.categories || []).map(category => category.category_name).join(', ')].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="view-actions">
                    <DeadlineText request={nowWorking} />
                    <button type="button" className="btn btn-secondary" onClick={() => onOpenRequest(nowWorking)}>Open request</button>
                  </div>
                </div>
              </section>
            )}

            <div className="kpi-row" aria-busy={statsLoading}>
              {kpis.map(kpi => (
                <button key={kpi.label} type="button" className="kpi" onClick={() => onShowRequests(categoryKey, kpi.filter)} title={`Show ${kpi.label.toLowerCase()} requests`}>
                  <span className="kpi-label">{kpi.label}</span>
                  <span className="kpi-value" data-tone={kpi.tone}>{loadingValue(kpi.value)}</span>
                  <span className="kpi-foot">{kpi.foot}</span>
                </button>
              ))}
            </div>

            <div className="overview-grid">
              <div className="overview-column">
                <section className="panel">
                  <header className="panel-header">
                    <div>
                      <h2 className="panel-title">Needs attention</h2>
                      <p className="panel-subtitle">Deadlines first, then decisions and sync problems.</p>
                    </div>
                  </header>
                  <div className="panel-body">
                    {attentionGroups.length === 0 ? (
                      <p className="muted" style={{ fontSize: 'var(--text-md)' }}>
                        Nothing is overdue or waiting on you. {overview.active ? 'Pick up an active request whenever you’re ready.' : ''}
                      </p>
                    ) : attentionGroups.map(group => (
                      <div key={group.key} className={`attention-group tone-${group.tone}`}>
                        <div className="attention-group-header">
                          <span className="attention-group-title">{group.title}<span className="count-badge">{group.requests.length}</span></span>
                          {group.requests.length > ATTENTION_PREVIEW && (
                            <button type="button" className="btn-link" style={{ fontSize: 'var(--text-sm)' }} onClick={() => onShowRequests(categoryKey, group.filter)}>
                              Show all<ArrowRight size={13} />
                            </button>
                          )}
                        </div>
                        <div className="request-list">
                          {group.requests.slice(0, ATTENTION_PREVIEW).map(request => (
                            <RequestListItem
                              key={request.id}
                              request={request}
                              onOpen={onOpenRequest}
                              aside={group.key === 'sync-failed'
                                ? <span className="pill map-failed">Sync failed</span>
                                : describeDeadline(request.deadline, request.request_status)
                                  ? <DeadlineText request={request} />
                                  : <StatusPill status={request.request_status} />}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="panel">
                  <header className="panel-header">
                    <h2 className="panel-title">Recently added</h2>
                    <button type="button" className="btn-link" style={{ fontSize: 'var(--text-sm)' }} onClick={() => onShowRequests(categoryKey, {})}>
                      All requests<ArrowRight size={13} />
                    </button>
                  </header>
                  <div className="panel-body request-list">
                    {recentlyAdded.length === 0
                      ? <p className="muted">No requests in this category yet.</p>
                      : recentlyAdded.map(request => (
                        <RequestListItem
                          key={request.id}
                          request={request}
                          onOpen={onOpenRequest}
                          aside={<><span className="muted">{formatRelativeTime(request.added_date)}</span><StatusPill status={request.request_status} /></>}
                        />
                      ))}
                  </div>
                </section>
              </div>

              <div className="overview-column">
                <section className="panel">
                  <header className="panel-header">
                    <div>
                      <h2 className="panel-title">Last 12 months</h2>
                      <p className="panel-subtitle">Requests added and completed each month.</p>
                    </div>
                  </header>
                  <div className="panel-body">
                    {stats?.monthlyActivity ? <ActivityChart months={stats.monthlyActivity} /> : <div className="skeleton" style={{ height: 150 }} />}
                  </div>
                </section>

                <section className="panel">
                  <header className="panel-header">
                    <div>
                      <h2 className="panel-title">Top requesters</h2>
                      <p className="panel-subtitle">Who sends you the most work. Your own maps aren’t counted.</p>
                    </div>
                  </header>
                  <div className="panel-body">
                    {requesters.length === 0 ? <p className="muted">No requesters yet.</p> : requesters.slice(0, 8).map(requester => (
                      <div key={requester.username} className="requester-row">
                        <Avatar src={requester.avatar_url} name={requester.username} />
                        <div style={{ minWidth: 0 }}>
                          <div className="truncate" style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>
                            {requester.country_code && <span className="country-flag" title={requester.country_code.toUpperCase()} style={{ marginRight: 6 }}>{countryCodeToFlag(requester.country_code)}</span>}
                            {requester.username}
                          </div>
                          <div className="requester-bar"><span style={{ width: `${(requester.count / maxRequesterCount) * 100}%` }} /></div>
                        </div>
                        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{requester.count}</strong>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="panel">
                  <header className="panel-header">
                    <div>
                      <h2 className="panel-title">By year</h2>
                      <p className="panel-subtitle">Completed requests, by the map’s ranked or last-updated year.</p>
                    </div>
                  </header>
                  <div className="panel-body">
                    {(stats?.yearSummary || []).length === 0 ? <p className="muted">Completed requests will appear here.</p> : (
                      <table className="simple-table">
                        <thead>
                          <tr><th>Year</th><th className="numeric">Completed</th><th className="numeric">Drain time</th><th>Top requester</th></tr>
                        </thead>
                        <tbody>
                          {stats.yearSummary.map(year => (
                            <tr key={year.year}>
                              <td style={{ fontWeight: 650 }}>{year.year}</td>
                              <td className="numeric">{year.completedCount}</td>
                              <td className="numeric">{year.totalDrainTime}</td>
                              <td className="truncate" style={{ maxWidth: 160 }}>{year.mostRequestedUser === 'None' ? '—' : year.mostRequestedUser}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
