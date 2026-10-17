const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db');

// Helper to format seconds into readable hours/minutes
function formatDrainTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0 hours';
  const hours = seconds / 3600;
  if (hours < 1) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minutes`;
  }
  return `${hours.toFixed(1)} hours`;
}

// Determine the effective requester (falls back to beatmap creator when none set)
function getEffectiveRequester(row, userMap = new Map()) {
  const hasExplicit = !!row.requester_id ||
    (row.requester_username && row.requester_username.toLowerCase() !== 'anonymous');
  if (hasExplicit) {
    return { id: row.requester_id, name: userMap.get(row.requester_id)?.username || row.requester_username };
  }
  if (row.creator) {
    return { id: row.creator_id, name: userMap.get(row.creator_id)?.username || row.creator };
  }
  return null;
}

// Determine the year used for the yearly breakdown. Prefers the beatmap's
// ranked/loved date, then its last-updated date, then the request completion date.
function getEffectiveYear(row) {
  const status = (row.ranked_status || '').toLowerCase();
  let dateStr = null;
  if ((status === 'ranked' || status === 'loved') && row.ranked_date) {
    dateStr = row.ranked_date;
  } else if (row.osu_last_updated) {
    dateStr = row.osu_last_updated;
  } else if (row.completed_date) {
    dateStr = row.completed_date;
  }
  if (!dateStr) return null;
  const year = new Date(dateStr).getFullYear();
  return isNaN(year) ? null : year;
}

// Calendar dates (deadlines) are stored as local YYYY-MM-DD values, so "today"
// must be the local calendar day rather than the UTC one.
function localDateString(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// The connected mapper is the one receiving requests, so they never count as
// a requester in rankings.
function createRequesterExclusion({ excludeUserId = null, excludeUsername = null } = {}) {
  const userId = Number(excludeUserId);
  const username = typeof excludeUsername === 'string' ? excludeUsername.toLowerCase() : null;
  return (requester) => Boolean(requester && (
    (Number.isSafeInteger(userId) && userId > 0 && Number(requester.id) === userId)
    || (username && String(requester.name || '').toLowerCase() === username)
  ));
}

function getCategoryScope(categoryId, requestAlias = 'r') {
  if (!categoryId) return { predicate: '1 = 1', params: [] };
  return {
    predicate: `EXISTS (
      SELECT 1
      FROM request_categories scoped_category
      WHERE scoped_category.request_id = ${requestAlias}.id
        AND scoped_category.category_id = ?
    )`,
    params: [categoryId],
  };
}

async function resolveStatsCategoryId(db, rawCategoryId) {
  if (rawCategoryId === undefined || rawCategoryId === '' || rawCategoryId === 'all') return null;

  const categoryId = Number(rawCategoryId);
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) {
    const error = new Error('categoryId must be a positive integer.');
    error.status = 400;
    throw error;
  }

  const category = await db.get(
    'SELECT id FROM categories WHERE id = ? AND is_active = 1',
    categoryId
  );
  if (!category) {
    const error = new Error('Unknown or inactive request category.');
    error.status = 400;
    throw error;
  }
  return categoryId;
}

async function getDashboardStats(db, { categoryId = null, now = new Date(), excludeUserId = null, excludeUsername = null } = {}) {
  const scope = getCategoryScope(categoryId);
  const isExcludedRequester = createRequesterExclusion({ excludeUserId, excludeUsername });

  // 1. Overview counts
  const totalRequestsRow = await db.get(`
    SELECT COUNT(*) AS count FROM requests r WHERE ${scope.predicate}
  `, scope.params);
  const activeRequestsRow = await db.get(`
    SELECT COUNT(*) AS count
    FROM requests r
    WHERE ${scope.predicate}
      AND r.request_status IN ('Accepted', 'Considering', 'Working')
  `, scope.params);
  const completedRequestsRow = await db.get(`
    SELECT COUNT(*) AS count
    FROM requests r
    WHERE ${scope.predicate}
      AND r.request_status = 'Completed'
  `, scope.params);

  // Due in the next 7 days, after today (today counts as overdue, matching the
  // Overview's drill-through filters).
  const oneWeekLater = new Date(now);
  oneWeekLater.setDate(now.getDate() + 7);

  const nowStr = localDateString(now);
  const oneWeekLaterStr = localDateString(oneWeekLater);

  const dueSoonRow = await db.get(`
    SELECT COUNT(*) AS count
    FROM requests r
    WHERE ${scope.predicate}
      AND r.request_status IN ('Accepted', 'Considering', 'Working')
      AND deadline IS NOT NULL
      AND deadline > ?
      AND deadline <= ?
  `, [...scope.params, nowStr, oneWeekLaterStr]);

  const overdueRow = await db.get(`
    SELECT COUNT(*) AS count
    FROM requests r
    WHERE ${scope.predicate}
      AND r.request_status IN ('Accepted', 'Considering', 'Working')
      AND deadline IS NOT NULL
      AND deadline != ''
      AND deadline <= ?
  `, [...scope.params, nowStr]);

  // 12-month activity trend: requests added and completed per calendar month.
  const firstMonth = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const months = Array.from({ length: 12 }, (_, index) => monthKey(new Date(firstMonth.getFullYear(), firstMonth.getMonth() + index, 1)));
  const activityRows = await db.all(`
    SELECT substr(r.added_date, 1, 7) AS month, 'added' AS kind, COUNT(*) AS count
    FROM requests r
    WHERE ${scope.predicate} AND r.added_date IS NOT NULL AND substr(r.added_date, 1, 7) >= ?
    GROUP BY month
    UNION ALL
    SELECT substr(r.completed_date, 1, 7) AS month, 'completed' AS kind, COUNT(*) AS count
    FROM requests r
    WHERE ${scope.predicate} AND r.request_status = 'Completed' AND r.completed_date IS NOT NULL AND substr(r.completed_date, 1, 7) >= ?
    GROUP BY month
  `, [...scope.params, months[0], ...scope.params, months[0]]);
  const activityByMonth = new Map(months.map(month => [month, { month, added: 0, completed: 0 }]));
  for (const row of activityRows) {
    const bucket = activityByMonth.get(row.month);
    if (bucket) bucket[row.kind] += row.count;
  }

  // User cache for avatars/countries
  const usersList = await db.all('SELECT * FROM users_cache');
  const userMap = new Map(usersList.map(u => [u.id, u]));

  // 2. Fetch all completed requests with cached beatmaps to compute drain time and ranked status
  const completedRequests = await db.all(`
    SELECT r.id, r.completed_date, r.requester_id, r.requester_username,
           b.ranked_status, b.difficulties_json, b.creator, b.creator_id, b.ranked_date, b.osu_last_updated
    FROM requests r
    LEFT JOIN beatmap_cache b ON r.beatmapset_id = b.beatmapset_id
    WHERE ${scope.predicate}
      AND r.request_status = 'Completed'
  `, scope.params);

  let totalDrainSeconds = 0;
  let rankedCompletedCount = 0;
  const requesterCounts = {};

  completedRequests.forEach(req => {
    // Calculate drain time for this completed request
    let maxDrain = 0;
    if (req.difficulties_json) {
      try {
        const diffs = JSON.parse(req.difficulties_json);
        // Find max drain time in the set
        maxDrain = diffs.reduce((max, d) => (d.drain > max ? d.drain : max), 0);
      } catch (e) {
        console.error(`Error parsing difficulties_json for request ${req.id}:`, e);
      }
    }
    totalDrainSeconds += maxDrain;

    // Check if ranked status is Ranked
    if (req.ranked_status && req.ranked_status.toLowerCase() === 'ranked') {
      rankedCompletedCount++;
    }

    // Count requesters (using creator fallback)
    const eff = getEffectiveRequester(req, userMap);
    if (eff && eff.name && !isExcludedRequester(eff)) {
      requesterCounts[eff.name] = (requesterCounts[eff.name] || 0) + 1;
    }
  });

  // Find most frequent requester
  let mostFrequentRequester = 'None';
  let maxRequesterCount = 0;
  for (const [username, count] of Object.entries(requesterCounts)) {
    if (count > maxRequesterCount) {
      mostFrequentRequester = username;
      maxRequesterCount = count;
    }
  }

  // 3. Year Summary Breakdown
  // Group completed requests by the beatmap's ranked/loved (or last-updated) year
  const yearSummary = {};

  completedRequests.forEach(req => {
    const year = getEffectiveYear(req);
    if (year === null) return;

    if (!yearSummary[year]) {
      yearSummary[year] = {
        year,
        completedCount: 0,
        drainSeconds: 0,
        requesters: {}
      };
    }

    yearSummary[year].completedCount++;

    let maxDrain = 0;
    if (req.difficulties_json) {
      try {
        const diffs = JSON.parse(req.difficulties_json);
        maxDrain = diffs.reduce((max, d) => (d.drain > max ? d.drain : max), 0);
      } catch (e) {}
    }
    yearSummary[year].drainSeconds += maxDrain;

    const eff = getEffectiveRequester(req, userMap);
    if (eff && eff.name && !isExcludedRequester(eff)) {
      yearSummary[year].requesters[eff.name] = (yearSummary[year].requesters[eff.name] || 0) + 1;
    }
  });

  const yearSummaryList = Object.values(yearSummary).map(y => {
    let topUser = 'None';
    let topCount = 0;
    for (const [username, count] of Object.entries(y.requesters)) {
      if (count > topCount) {
        topUser = username;
        topCount = count;
      }
    }

    return {
      year: y.year,
      completedCount: y.completedCount,
      totalDrainTime: formatDrainTime(y.drainSeconds),
      mostRequestedUser: topUser
    };
  }).sort((a, b) => b.year - a.year); // Sorted descending by year

  // 4. Requester Breakdown (across all requests, using creator fallback)
  const allRequests = await db.all(`
    SELECT r.requester_id, r.requester_username, b.creator, b.creator_id
    FROM requests r
    LEFT JOIN beatmap_cache b ON r.beatmapset_id = b.beatmapset_id
    WHERE ${scope.predicate}
  `, scope.params);

  const requesterMap = {};
  allRequests.forEach(req => {
    const eff = getEffectiveRequester(req, userMap);
    if (!eff || !eff.name || isExcludedRequester(eff)) return;
    if (!requesterMap[eff.name]) {
      const cache = eff.id ? userMap.get(eff.id) : null;
      requesterMap[eff.name] = {
        username: eff.name,
        count: 0,
        avatar_url: cache ? cache.avatar_url : null,
        country_code: cache ? cache.country_code : null,
        profile_url: eff.id ? `https://osu.ppy.sh/users/${eff.id}` : null
      };
    }
    requesterMap[eff.name].count++;
  });

  const requesterBreakdown = Object.values(requesterMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    overview: {
      total: totalRequestsRow.count,
      active: activeRequestsRow.count,
      completed: completedRequestsRow.count,
      dueSoon: dueSoonRow.count,
      overdue: overdueRow.count
    },
    stats: {
      completedCount: completedRequestsRow.count,
      totalDrainTime: formatDrainTime(totalDrainSeconds),
      rankedCompletedCount,
      mostFrequentRequester
    },
    yearSummary: yearSummaryList,
    requesterBreakdown,
    monthlyActivity: [...activityByMonth.values()]
  };
}

// GET /api/stats - get dashboard statistics
router.get('/', async (req, res, next) => {
  try {
    const db = await getDatabase();
    const categoryId = await resolveStatsCategoryId(db, req.query.categoryId);
    const connectedRows = await db.all("SELECT key, value FROM settings WHERE key IN ('connected_user_id', 'connected_username')");
    const connected = new Map(connectedRows.map(row => [row.key, row.value]));
    res.json(await getDashboardStats(db, {
      categoryId,
      excludeUserId: connected.get('connected_user_id') || null,
      excludeUsername: connected.get('connected_username') || null,
    }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.getDashboardStats = getDashboardStats;
module.exports.resolveStatsCategoryId = resolveStatsCategoryId;
