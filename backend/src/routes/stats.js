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

// GET /api/stats - get dashboard statistics
router.get('/', async (req, res, next) => {
  try {
    const db = await getDatabase();

    // 1. Overview counts
    const totalRequestsRow = await db.get('SELECT COUNT(*) AS count FROM requests');
    const activeRequestsRow = await db.get("SELECT COUNT(*) AS count FROM requests WHERE request_status IN ('Accepted', 'Working')");
    const completedRequestsRow = await db.get("SELECT COUNT(*) AS count FROM requests WHERE request_status = 'Completed'");

    // Due within a week (7 days)
    const now = new Date();
    const oneWeekLater = new Date();
    oneWeekLater.setDate(now.getDate() + 7);
    
    const nowStr = now.toISOString().split('T')[0];
    const oneWeekLaterStr = oneWeekLater.toISOString().split('T')[0];

    const dueSoonRow = await db.get(`
      SELECT COUNT(*) AS count 
      FROM requests 
      WHERE request_status IN ('Accepted', 'Working') 
        AND deadline IS NOT NULL 
        AND deadline >= ? 
        AND deadline <= ?
    `, [nowStr, oneWeekLaterStr]);

    // 2. Fetch all completed requests with cached beatmaps to compute drain time and ranked status
    const completedRequests = await db.all(`
      SELECT r.id, r.completed_date, r.requester_username, b.ranked_status, b.difficulties_json
      FROM requests r
      LEFT JOIN beatmap_cache b ON r.beatmapset_id = b.beatmapset_id
      WHERE r.request_status = 'Completed'
    `);

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

      // Count requesters
      if (req.requester_username && req.requester_username.toLowerCase() !== 'anonymous') {
        requesterCounts[req.requester_username] = (requesterCounts[req.requester_username] || 0) + 1;
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
    // Group completed requests by completion year
    const yearSummary = {};

    completedRequests.forEach(req => {
      if (!req.completed_date) return;
      const year = new Date(req.completed_date).getFullYear();
      if (isNaN(year)) return;

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

      if (req.requester_username && req.requester_username.toLowerCase() !== 'anonymous') {
        yearSummary[year].requesters[req.requester_username] = (yearSummary[year].requesters[req.requester_username] || 0) + 1;
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

    res.json({
      overview: {
        total: totalRequestsRow.count,
        active: activeRequestsRow.count,
        completed: completedRequestsRow.count,
        dueSoon: dueSoonRow.count
      },
      stats: {
        completedCount: completedRequestsRow.count,
        totalDrainTime: formatDrainTime(totalDrainSeconds),
        rankedCompletedCount,
        mostFrequentRequester
      },
      yearSummary: yearSummaryList
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
