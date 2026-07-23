const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db');
const { fetchBeatmapset, fetchUser, downloadCover, addApiJobWork, updateApiJob } = require('../osuApi');
const {
  canonicalDifficultyNames,
  getUnavailableUserIds,
  recordUnavailableUser,
  recordUserIdentity,
} = require('../utils/userIdentity');
const { reconcileGuestDifficultyAssignments } = require('../utils/guestDifficultyAssignments');

// Fetch and cache a user profile (used for beatmap creators / requesters)
async function cacheUser(db, userIdOrUsername, includedUser = null) {
  try {
    const userData = includedUser || await fetchUser(userIdOrUsername);
    if (userData) {
      await recordUserIdentity(db, userData);
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

async function hydrateDifficultyNames(db, cacheEntry) {
  const difficulties = JSON.parse(cacheEntry.difficulties_json || '[]');
  const usersById = new Map((await db.all('SELECT id, username FROM users_cache')).map(user => [user.id, user]));
  return difficulties.map(difficulty => canonicalDifficultyNames(difficulty, usersById));
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

  // Persist the canonical current username rather than the mutable legacy
  // beatmap metadata creator field.
  await cacheUser(db, mapsetData.user_id, mapsetData.user);

  // Extract difficulties and record every embedded owner identity.
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

  for (const owner of (mapsetData.beatmaps || []).flatMap(beatmap => Array.isArray(beatmap.owners) ? beatmap.owners : [])) {
    // Owners in the beatmapset response already carry current usernames.
    await recordUserIdentity(db, owner);
  }

  // Get Beatmapset normally embeds its creator, avoiding another API request.
  if (!mapsetData.user && apiJobId) {
    addApiJobWork(apiJobId, 1);
    updateApiJob(apiJobId, 1);
  }
  if (!mapsetData.user) await cacheUser(db, mapsetData.user_id);

  const cacheEntry = {
    beatmapset_id: mapsetData.id,
    artist: mapsetData.artist,
    title: mapsetData.title,
    creator: mapsetData.user?.username || mapsetData.creator,
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

  // Keep uploaded guest assignments current. If osu! removed a difficulty, retain
  // the user's record as a manual difficulty rather than dropping it on refresh.
  const linkedRequests = await db.all('SELECT id FROM requests WHERE beatmapset_id = ?', beatmapsetId);
  for (const request of linkedRequests) {
    await reconcileGuestDifficultyAssignments(db, request.id, { difficulties });
  }
  await db.run(`
    UPDATE beatmap_metadata_sync
    SET status = 'Completed', last_error = NULL, next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE beatmapset_id = ?
  `, beatmapsetId);

  return { ...cacheEntry, difficulties };
}

// Reconcile older cached creator names by refreshing each distinct stable osu!
// user ID at most once a week. This is deliberately separate from beatmap
// metadata refreshes so a rename updates every existing request at once.
async function refreshKnownCreatorIdentities(db) {
  const credentials = await db.all("SELECT key FROM settings WHERE key IN ('osu_client_id', 'osu_client_secret')");
  if (credentials.length < 2) return 0;
  const caches = await db.all('SELECT creator, creator_id, difficulties_json FROM beatmap_cache');
  const ids = new Set();
  const usernamesById = new Map();
  const addCandidate = (rawId, username = null) => {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    ids.add(id);
    if (username && !usernamesById.has(id)) usernamesById.set(id, username);
  };
  for (const cache of caches) {
    addCandidate(cache.creator_id, cache.creator);
    try {
      for (const difficulty of JSON.parse(cache.difficulties_json || '[]')) {
        const creatorIds = Array.isArray(difficulty.creator_ids) && difficulty.creator_ids.length > 0
          ? difficulty.creator_ids
          : [difficulty.creator_id];
        const creatorNames = Array.isArray(difficulty.creator_names) && difficulty.creator_names.length > 0
          ? difficulty.creator_names
          : [difficulty.creator_name];
        for (let index = 0; index < creatorIds.length; index++) {
          addCandidate(creatorIds[index], creatorNames[index]);
        }
      }
    } catch {
      // A malformed legacy cache will be repaired by its normal metadata sync.
    }
  }
  const existingUsers = new Map((await db.all('SELECT id, last_updated FROM users_cache')).map(user => [user.id, user]));
  const unavailableUserIds = await getUnavailableUserIds(db);
  let refreshed = 0;
  for (const id of ids) {
    if (unavailableUserIds.has(id)) continue;
    const cached = existingUsers.get(id);
    const age = cached?.last_updated ? Date.now() - new Date(cached.last_updated).getTime() : Infinity;
    if (Number.isFinite(age) && age < 7 * 24 * 60 * 60 * 1000) continue;
    const user = await fetchUser(id);
    if (user) {
      await recordUserIdentity(db, user);
      refreshed += 1;
    } else {
      await recordUnavailableUser(db, id, usernamesById.get(id));
      unavailableUserIds.add(id);
    }
  }
  return refreshed;
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

// GET /api/beatmaps/sync/failed - inspect persistent metadata errors before retrying.
router.get('/sync/failed', async (req, res, next) => {
  try {
    const db = await getDatabase();
    const { getFailedMetadata } = require('../services/beatmapMetadataSync');
    res.json(await getFailedMetadata(db));
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
        cached.difficulties = await hydrateDifficultyNames(db, cached);
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
        cached.difficulties = await hydrateDifficultyNames(db, cached);
        return res.json(cached);
      }
    }

    // Cache miss or expired: fetch and cache
    console.log(`Cache miss or expired for beatmapset ${beatmapsetId}. Fetching from osu! API...`);
    const freshData = await refreshAndCacheBeatmapset(db, beatmapsetId);
    freshData.difficulties = await hydrateDifficultyNames(db, freshData);
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
    freshData.difficulties = await hydrateDifficultyNames(db, freshData);
    
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
  refreshAndCacheBeatmapset,
  refreshKnownCreatorIdentities
};
