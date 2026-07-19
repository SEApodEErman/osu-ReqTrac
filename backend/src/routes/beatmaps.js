const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db');
const { fetchBeatmapset, fetchUser, downloadCover, addApiJobWork, updateApiJob } = require('../osuApi');

// Fetch and cache a user profile (used for beatmap creators / requesters)
async function cacheUser(db, userIdOrUsername, includedUser = null) {
  try {
    const userData = includedUser || await fetchUser(userIdOrUsername);
    if (userData) {
      await db.run(`
        INSERT OR REPLACE INTO users_cache (id, username, avatar_url, country_code, last_updated)
        VALUES (?, ?, ?, ?, ?)
      `, [userData.id, userData.username, userData.avatar_url, userData.country_code, new Date().toISOString()]);
      return userData;
    }
  } catch (error) {
    console.error('Failed to cache user:', error.message);
  }
  return null;
}

// Helper to check if cache is older than 7 days
function isCacheExpired(lastUpdatedStr) {
  const lastUpdated = new Date(lastUpdatedStr);
  const diffTime = Math.abs(new Date() - lastUpdated);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays > 7;
}

// Function to fetch, download cover, and cache a beatmapset
async function refreshAndCacheBeatmapset(db, beatmapsetId, apiJobId = null) {
  if (apiJobId) updateApiJob(apiJobId, 1);
  const mapsetData = await fetchBeatmapset(beatmapsetId);
  if (!mapsetData) {
    throw new Error(`Beatmapset with ID ${beatmapsetId} not found on osu!`);
  }

  // Download cover image
  const localCoverPath = await downloadCover(beatmapsetId, mapsetData.covers?.cover);

  // Extract difficulties
  const difficulties = mapsetData.beatmaps.map(b => {
    const owners = Array.isArray(b.owners)
      ? b.owners.filter(owner => owner?.username)
      : [];
    const creatorNames = owners.length > 0
      ? owners.map(owner => owner.username)
      : (mapsetData.creator ? [mapsetData.creator] : []);
    const creatorIds = owners
      .map(owner => owner.id)
      .filter(id => id !== undefined && id !== null);

    return {
      id: b.id,
      name: b.version,
      stars: b.difficulty_rating,
      drain: b.hit_length, // hit_length is drain time (seconds)
      bpm: b.bpm,
      cs: b.cs,
      ar: b.ar,
      od: b.accuracy,
      hp: b.drain,
      mode: b.mode || (b.mode_int === 1 ? 'taiko' : b.mode_int === 2 ? 'fruits' : b.mode_int === 3 ? 'mania' : 'osu'),
      creator_id: creatorIds[0] ?? b.user_id,
      creator_ids: creatorIds.length > 0 ? creatorIds : (b.user_id ? [b.user_id] : []),
      creator_name: creatorNames[0] || mapsetData.creator,
      creator_names: creatorNames
    };
  });

  // Get Beatmapset normally embeds its creator, avoiding another API request.
  if (!mapsetData.user && apiJobId) {
    addApiJobWork(apiJobId, 1);
    updateApiJob(apiJobId, 1);
  }
  await cacheUser(db, mapsetData.user_id, mapsetData.user);

  const cacheEntry = {
    beatmapset_id: mapsetData.id,
    artist: mapsetData.artist,
    title: mapsetData.title,
    creator: mapsetData.creator,
    creator_id: mapsetData.user_id,
    cover_url: mapsetData.covers?.cover || '',
    local_cover_path: localCoverPath,
    ranked_status: mapsetData.status.charAt(0).toUpperCase() + mapsetData.status.slice(1).toLowerCase(), // Capitalize status
    difficulties_json: JSON.stringify(difficulties),
    ranked_date: mapsetData.ranked_date || null,
    osu_last_updated: mapsetData.last_updated || null,
    submitted_date: mapsetData.submitted_date || null,
    last_updated: new Date().toISOString()
  };

  await db.run(`
    INSERT OR REPLACE INTO beatmap_cache (
      beatmapset_id, artist, title, creator, creator_id, cover_url, local_cover_path, ranked_status, difficulties_json, ranked_date, osu_last_updated, submitted_date, metadata_complete, last_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `, [
    cacheEntry.beatmapset_id,
    cacheEntry.artist,
    cacheEntry.title,
    cacheEntry.creator,
    cacheEntry.creator_id,
    cacheEntry.cover_url,
    cacheEntry.local_cover_path,
    cacheEntry.ranked_status,
    cacheEntry.difficulties_json,
    cacheEntry.ranked_date,
    cacheEntry.osu_last_updated,
    cacheEntry.submitted_date,
    cacheEntry.last_updated
  ]);
  await db.run(`
    UPDATE beatmap_metadata_sync
    SET status = 'Completed', last_error = NULL, next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE beatmapset_id = ?
  `, beatmapsetId);

  return cacheEntry;
}

// GET /api/beatmaps/sync/status - persistent background metadata progress.
router.get('/sync/status', async (req, res, next) => {
  try {
    const db = await getDatabase();
    const { getMetadataSyncStatus } = require('../services/beatmapMetadataSync');
    res.json(await getMetadataSyncStatus(db));
  } catch (error) {
    next(error);
  }
});

// POST /api/beatmaps/sync/retry - retry entries that exhausted automatic attempts.
router.post('/sync/retry', async (req, res, next) => {
  try {
    const db = await getDatabase();
    const { retryFailedMetadata } = require('../services/beatmapMetadataSync');
    const retried = await retryFailedMetadata(db);
    res.json({ success: true, retried, message: `Queued ${retried} failed beatmapsets for retry.` });
  } catch (error) {
    next(error);
  }
});

// GET /api/beatmaps/:id - query details for a beatmapset
router.get('/:id', async (req, res, next) => {
  try {
    const beatmapsetId = parseInt(req.params.id, 10);
    if (isNaN(beatmapsetId)) {
      return res.status(400).json({ error: 'Invalid beatmapset ID' });
    }

    const db = await getDatabase();
    let cached = await db.get('SELECT * FROM beatmap_cache WHERE beatmapset_id = ?', beatmapsetId);

    if (cached) {
      if (req.query.cacheOnly === '1') {
        cached.difficulties = JSON.parse(cached.difficulties_json || '[]');
        return res.json(cached);
      }

      const status = cached.ranked_status.toLowerCase();
      let needsRefresh = false;

      if (!cached.metadata_complete) {
        needsRefresh = true;
      }
      // Rule: Ranked/Loved never automatically update
      else if (status === 'ranked' || status === 'loved') {
        needsRefresh = false;
      }
      // Rule: Pending/WIP are updated on request status change or manual refresh (handled elsewhere)
      else if (status === 'pending' || status === 'wip') {
        needsRefresh = false; // don't auto refresh on simple fetch
      }
      // Rule: Other statuses (Qualified, Graveyard, etc.) update once per week
      else {
        needsRefresh = isCacheExpired(cached.last_updated);
      }

      if (!needsRefresh) {
        cached.difficulties = JSON.parse(cached.difficulties_json);
        return res.json(cached);
      }
    }

    // Cache miss or expired: fetch and cache
    console.log(`Cache miss or expired for beatmapset ${beatmapsetId}. Fetching from osu! API...`);
    const freshData = await refreshAndCacheBeatmapset(db, beatmapsetId);
    freshData.difficulties = JSON.parse(freshData.difficulties_json);
    res.json(freshData);
  } catch (error) {
    next(error);
  }
});

// POST /api/beatmaps/refresh - Force manual refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { beatmapset_id } = req.body;
    if (!beatmapset_id) {
      return res.status(400).json({ error: 'beatmapset_id is required' });
    }

    const db = await getDatabase();
    console.log(`Forced manual refresh for beatmapset ${beatmapset_id}...`);
    const freshData = await refreshAndCacheBeatmapset(db, beatmapset_id);
    freshData.difficulties = JSON.parse(freshData.difficulties_json);
    
    res.json({
      success: true,
      message: 'Beatmap metadata refreshed successfully',
      data: freshData
    });
  } catch (error) {
    next(error);
  }
});

module.exports = {
  router,
  refreshAndCacheBeatmapset
};
