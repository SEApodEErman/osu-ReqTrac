const { getDatabase } = require('../db');

function formatDrainTime(seconds) {
  if (!seconds || Number.isNaN(seconds)) return '0 hours';
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)} minutes`;
  return `${hours.toFixed(1)} hours`;
}

function effectiveYear(request) {
  const mapStatus = String(request.mapStatus || '').toLowerCase();
  const date = (['ranked', 'loved'].includes(mapStatus) && request.rankedDate)
    || request.osuLastUpdated
    || request.completedDate;
  if (!date) return null;
  const year = new Date(date).getFullYear();
  return Number.isNaN(year) ? null : year;
}

async function buildPublicSnapshot() {
  const db = await getDatabase();
  const connectedUsernameRow = await db.get('SELECT value FROM settings WHERE key = ?', 'connected_username');
  const connectedUsername = connectedUsernameRow?.value || '';
  const isConnectedUser = (username) => Boolean(connectedUsername && username
    && String(username).toLowerCase() === String(connectedUsername).toLowerCase());
  const requestRows = await db.all(`
    SELECT r.*, b.artist AS cache_artist, b.title AS cache_title,
           b.creator AS cache_creator, b.cover_url, b.ranked_status,
           b.ranked_date, b.osu_last_updated, b.difficulties_json
    FROM requests r
    LEFT JOIN beatmap_cache b ON r.beatmapset_id = b.beatmapset_id
    ORDER BY r.added_date DESC
  `);
  const categories = await db.all('SELECT request_id, category_name FROM request_categories ORDER BY id');
  const tags = await db.all('SELECT rt.request_id, t.name FROM request_tags rt JOIN tags t ON t.id = rt.tag_id ORDER BY t.name');

  const categoryMap = new Map();
  for (const row of categories) {
    if (!categoryMap.has(row.request_id)) categoryMap.set(row.request_id, []);
    categoryMap.get(row.request_id).push(row.category_name);
  }
  const tagMap = new Map();
  for (const row of tags) {
    if (!tagMap.has(row.request_id)) tagMap.set(row.request_id, []);
    tagMap.get(row.request_id).push(row.name);
  }

  // Manual/non-osu entries are intentionally kept local. They may represent
  // unreleased maps that should remain confidential until upload.
  const requests = requestRows.filter((row) => !!row.is_osu_link).map((row) => {
    let difficulties = [];
    try {
      difficulties = row.difficulties_json ? JSON.parse(row.difficulties_json) : [];
    } catch {
      difficulties = [];
    }
    const highestStars = difficulties.reduce((max, difficulty) => Math.max(max, Number(difficulty.stars) || 0), 0);
    const drainSeconds = difficulties.reduce((max, difficulty) => Math.max(max, Number(difficulty.drain) || 0), 0);
    const requester = row.requester_id || (row.requester_username && row.requester_username.toLowerCase() !== 'anonymous')
      ? row.requester_username
      : row.cache_creator;

    return {
      isOsuLink: true,
      artist: row.cache_artist,
      title: row.cache_title,
      creator: row.cache_creator,
      requester,
      status: row.request_status,
      priority: row.priority,
      deadline: row.deadline,
      notes: row.notes || '',
      categories: categoryMap.get(row.id) || [],
      tags: tagMap.get(row.id) || [],
      mapStatus: row.ranked_status,
      numDifficulties: difficulties.length,
      highestStars,
      guestStars: row.guest_difficulty_target_sr || highestStars,
      drainSeconds,
      rankedDate: row.ranked_date,
      osuLastUpdated: row.osu_last_updated,
      addedDate: row.added_date,
      completedDate: row.completed_date,
      osuUrl: row.beatmapset_id ? `https://osu.ppy.sh/beatmapsets/${row.beatmapset_id}` : '',
      coverUrl: row.cover_url || `https://assets.ppy.sh/beatmaps/${row.beatmapset_id}/covers/cover.jpg`
    };
  });

  const completedRequests = requests.filter((request) => request.status === 'Completed');
  const completed = completedRequests.length;
  const active = requests.filter((request) => ['Accepted', 'Considering', 'Working'].includes(request.status)).length;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const week = new Date(now);
  week.setDate(week.getDate() + 7);
  const weekDate = week.toISOString().slice(0, 10);
  const dueSoon = requests.filter((request) => ['Accepted', 'Considering', 'Working'].includes(request.status)
    && request.deadline && request.deadline >= today && request.deadline <= weekDate).length;
  const statusCounts = requests.reduce((counts, request) => {
    counts[request.status] = (counts[request.status] || 0) + 1;
    return counts;
  }, {});
  const completedRequesterCounts = completedRequests.reduce((counts, request) => {
    if (request.requester) counts[request.requester] = (counts[request.requester] || 0) + 1;
    return counts;
  }, {});
  const requesterCounts = requests.reduce((counts, request) => {
    if (request.requester) counts[request.requester] = (counts[request.requester] || 0) + 1;
    return counts;
  }, {});
  const requesterBreakdown = Object.entries(requesterCounts)
    .map(([username, count]) => ({ username, count }))
    .sort((a, b) => b.count - a.count)
    .filter((requester) => !isConnectedUser(requester.username))
    .slice(0, 10);
  const completedRequesterBreakdown = Object.entries(completedRequesterCounts)
    .map(([username, count]) => ({ username, count }))
    .sort((a, b) => b.count - a.count);
  const completedTopRequester = completedRequesterBreakdown[0]?.username || 'None';
  const mostFrequentRequester = isConnectedUser(completedTopRequester)
    ? (requesterBreakdown[0]?.username || 'None')
    : completedTopRequester;
  const yearMap = new Map();
  for (const request of completedRequests) {
    const year = effectiveYear(request);
    if (year === null) continue;
    if (!yearMap.has(year)) yearMap.set(year, { year, completedCount: 0, drainSeconds: 0, requesters: {} });
    const summary = yearMap.get(year);
    summary.completedCount += 1;
    summary.drainSeconds += request.drainSeconds;
    if (request.requester) summary.requesters[request.requester] = (summary.requesters[request.requester] || 0) + 1;
  }
  const yearSummary = [...yearMap.values()].map((summary) => {
    const yearTopRequester = Object.entries(summary.requesters)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'None';
    return {
      year: summary.year,
      completedCount: summary.completedCount,
      totalDrainTime: formatDrainTime(summary.drainSeconds),
      mostRequestedUser: isConnectedUser(yearTopRequester)
        ? (requesterBreakdown[0]?.username || 'None')
        : yearTopRequester
    };
  }).sort((a, b) => b.year - a.year);
  const totalDrainSeconds = completedRequests.reduce((total, request) => total + request.drainSeconds, 0);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    ownerUsername: connectedUsername,
    requests,
    stats: {
      total: requests.length,
      active,
      completed,
      dueSoon,
      statusCounts,
      completedCount: completed,
      totalDrainTime: formatDrainTime(totalDrainSeconds),
      rankedCompletedCount: completedRequests.filter((request) => String(request.mapStatus).toLowerCase() === 'ranked').length,
      mostFrequentRequester,
      yearSummary,
      requesterBreakdown
    }
  };
}

module.exports = { buildPublicSnapshot };
