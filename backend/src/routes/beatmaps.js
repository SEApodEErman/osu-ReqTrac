const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db');
const { fetchBeatmapset, fetchUser, downloadCover } = require('../osuApi');

// Fetch and cache a user profile (used for beatmap creators / requesters)
async function cacheUser(db, userIdOrUsername) {
  try {
    const userData = await fetchUser(userIdOrUsername);
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
async function refreshAndCacheBeatmapset(db, beatmapsetId) {
  const mapsetData = await fetchBeatmapset(beatmapsetId);
  if (!mapsetData) {
    throw new Error(`Beatmapset with ID ${beatmapsetId} not found on osu!`);
  }

  // Download cover image
  const localCoverPath = await downloadCover(beatmapsetId, mapsetData.covers?.cover);

  // Extract difficulties
  const difficulties = mapsetData.beatmaps.map(b => {
    const owner = b.owners && b.owners[0] ? b.owners[0] : null;
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
      creator_id: owner ? owner.id : b.user_id,
      creator_name: owner ? owner.username : mapsetData.creator
    };
  });

  // Cache the creator's user profile (name + avatar) to avoid repeat API calls
  await cacheUser(db, mapsetData.user_id);

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
      beatmapset_id, artist, title, creator, creator_id, cover_url, local_cover_path, ranked_status, difficulties_json, ranked_date, osu_last_updated, last_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    cacheEntry.last_updated
  ]);

  return cacheEntry;
}

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
      const status = cached.ranked_status.toLowerCase();
      let needsRefresh = false;

      // Rule: Ranked/Loved never automatically update
      if (status === 'ranked' || status === 'loved') {
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
