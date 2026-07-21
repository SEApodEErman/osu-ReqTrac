const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db');
const { fetchBeatmap, fetchBeatmapset, fetchUser, downloadCover } = require('../osuApi');
const { refreshAndCacheBeatmapset } = require('./beatmaps');
const { createApiJob, updateApiJob, finishApiJob } = require('../osuApi');
const { findUserDifficulties, isGuestDifficulty, normalizeGamemode, parseOsuLink, parseOsuUserLink } = require('../utils/requestUtils');
const { trackBackgroundTask } = require('../utils/backgroundTasks');
const { canonicalDifficultyNames, recordUserIdentity } = require('../utils/userIdentity');
const {
  ensureTag,
  normalizeCategories,
  normalizeGuestDifficulties,
  replaceGuestDifficulties,
  resolveCategory,
} = require('../utils/catalog');

const refreshDateJobs = new Map();
let nextRefreshDateJobId = 1;
const REFRESH_DATE_JOB_RETENTION_MS = 10 * 60 * 1000;

function pruneRefreshDateJobs() {
  const cutoff = Date.now() - REFRESH_DATE_JOB_RETENTION_MS;
  for (const [id, job] of refreshDateJobs) {
    if (job.completedAt && job.completedAt < cutoff) refreshDateJobs.delete(id);
  }
}

// Helper to update or cache a user profile
async function fetchAndCacheUser(db, userIdOrUsername) {
  try {
    const userData = await fetchUser(userIdOrUsername);
    if (userData) {
      return recordUserIdentity(db, userData);
    }
  } catch (error) {
    console.error('Failed to fetch/cache user:', error.message);
  }
  return null;
}

// GET /api/requests - list all requests with filters and sorting
router.get('/', async (req, res, next) => {
  try {
    const db = await getDatabase();
    
    // Fetch all requests and join with beatmap cache
    const requests = await db.all(`
      SELECT r.*, 
             b.artist AS cache_artist, b.title AS cache_title, b.creator AS cache_creator, b.creator_id AS cache_creator_id,
             b.cover_url, b.local_cover_path, b.ranked_status, b.difficulties_json, b.metadata_complete,
             ms.status AS metadata_sync_status, ms.last_error AS metadata_sync_error
      FROM requests r
      LEFT JOIN beatmap_cache b ON r.beatmapset_id = b.beatmapset_id
      LEFT JOIN beatmap_metadata_sync ms ON r.beatmapset_id = ms.beatmapset_id
      ORDER BY r.added_date DESC
    `);

    // Fetch all request categories
    const allCategories = await db.all(`
      SELECT rc.*, c.name AS catalog_name, c.system_key, c.view_type, c.is_active
      FROM request_categories rc
      LEFT JOIN categories c ON c.id = rc.category_id
    `);
    const categoriesByRequest = new Map();
    for (const category of allCategories) {
      if (!categoriesByRequest.has(category.request_id)) categoriesByRequest.set(category.request_id, []);
      categoriesByRequest.get(category.request_id).push({
        id: category.id,
        category_id: category.category_id,
        category_name: category.catalog_name || category.category_name,
        system_key: category.system_key || null,
        view_type: category.view_type || 'tagged',
        is_active: category.is_active ?? 1,
        other_text: category.other_text,
        status: category.status
      });
    }

    // Fetch all tags
    const allTags = await db.all(`
      SELECT rt.request_id, t.name 
      FROM request_tags rt 
      JOIN tags t ON rt.tag_id = t.id
    `);
    const tagsByRequest = new Map();
    for (const tag of allTags) {
      if (!tagsByRequest.has(tag.request_id)) tagsByRequest.set(tag.request_id, []);
      tagsByRequest.get(tag.request_id).push(tag.name);
    }

    const allGuestDifficultyRows = await db.all(`
      SELECT * FROM request_guest_difficulties ORDER BY request_id, sort_order, id
    `);
    const guestRowsByRequest = new Map();
    for (const row of allGuestDifficultyRows) {
      if (!guestRowsByRequest.has(row.request_id)) guestRowsByRequest.set(row.request_id, []);
      guestRowsByRequest.get(row.request_id).push(row);
    }

    // Fetch all user caches
    const usersList = await db.all('SELECT * FROM users_cache');
    const userMap = new Map(usersList.map(u => [u.id, u]));
    const usernameHistory = await db.all('SELECT user_id, username FROM user_username_history');
    const aliasesByUser = new Map();
    for (const row of usernameHistory) {
      if (!aliasesByUser.has(row.user_id)) aliasesByUser.set(row.user_id, []);
      aliasesByUser.get(row.user_id).push(row.username);
    }

    // Fetch connected user details from settings
    const connectedSettings = await db.all("SELECT key, value FROM settings WHERE key IN ('connected_user_id', 'connected_username')");
    const connectedSettingMap = new Map(connectedSettings.map(setting => [setting.key, setting.value]));
    const connectedUserId = connectedSettingMap.has('connected_user_id')
      ? parseInt(connectedSettingMap.get('connected_user_id'), 10)
      : null;
    const connectedUsername = connectedSettingMap.get('connected_username') || null;

    // Map categories, tags, and compute highest stars
    const formattedRequests = requests.map(reqRow => {
      const reqId = reqRow.id;
      
      const categories = categoriesByRequest.get(reqId) || [];
      const tags = tagsByRequest.get(reqId) || [];
      const assignedGuestDifficulties = guestRowsByRequest.get(reqId) || [];

      // Parse difficulties
      let difficulties = [];
      let highestStars = 0;
      let numDifficulties = 0;
      let guestDifficulties = [];
      let highestGuestStars = 0;
      let guestDifficultyCount = 0;
      let myGuestHighestStars = 0;

      if (reqRow.is_osu_link && reqRow.difficulties_json) {
        try {
          difficulties = JSON.parse(reqRow.difficulties_json).map(difficulty => canonicalDifficultyNames(difficulty, userMap));
          numDifficulties = difficulties.length;
          highestStars = difficulties.reduce((max, d) => d.stars > max ? d.stars : max, 0);

          // A difficulty is a guest difficulty when any assigned creator is not
          // the beatmapset creator.
          const beatmapsetCreatorId = reqRow.cache_creator_id;
          if (beatmapsetCreatorId) {
            guestDifficulties = difficulties.filter(d => isGuestDifficulty(d, beatmapsetCreatorId));
            guestDifficultyCount = guestDifficulties.length;
            highestGuestStars = guestDifficulties.reduce((max, d) => d.stars > max ? d.stars : max, 0);
          }
        } catch (e) {
          console.error(`Error parsing difficulties for request ${reqId}`, e);
        }
      } else if (!reqRow.is_osu_link) {
        // For non-osu links, mock a single difficulty based on text field
        numDifficulties = reqRow.non_osu_difficulty ? 1 : 0;
        highestStars = reqRow.guest_difficulty_target_sr || 0;
      }

      // Check if this request is a Guest Difficulties request
      const isGuestDiffRequest = categories.some(c =>
        c.system_key === 'guest_difficulties' || c.category_name === 'Guest Difficulties'
      );
      let userDifficulties = [];
      
      if (isGuestDiffRequest) {
        // Find if there's any difficulty belonging to the connected user
        if (reqRow.is_osu_link && difficulties.length > 0) {
          userDifficulties = findUserDifficulties(difficulties, {
            connectedUserId,
            connectedUsername,
            assignments: assignedGuestDifficulties,
          });
        }

        const resolvedIds = new Set(userDifficulties.map(difficulty => Number(difficulty.id)));
        const resolvedKeys = new Set(userDifficulties.map(difficulty =>
          `${normalizeGamemode(difficulty.mode)}:${difficulty.name?.toLowerCase()}`
        ));
        const unresolved = assignedGuestDifficulties
          .filter(assignment => !resolvedIds.has(Number(assignment.beatmap_id)) &&
            !resolvedKeys.has(`${normalizeGamemode(assignment.gamemode)}:${assignment.difficulty_name?.toLowerCase()}`))
          .map(assignment => ({
            id: null,
            assignment_id: assignment.id,
            name: assignment.difficulty_name,
            mode: normalizeGamemode(assignment.gamemode),
            stars: assignment.target_sr,
            pending: true,
          }));
        userDifficulties = [
          ...userDifficulties.map(difficulty => ({
            ...difficulty,
            mode: normalizeGamemode(difficulty.mode),
            pending: false,
          })),
          ...unresolved,
        ];
        myGuestHighestStars = userDifficulties.reduce(
          (maximum, difficulty) => Math.max(maximum, Number(difficulty.stars) || 0),
          0
        );
      }

      // Requester cache info
      const requesterCache = reqRow.requester_id ? userMap.get(reqRow.requester_id) : null;

      // Determine effective requester. When no explicit requester was provided
      // (e.g. imported rows default to "Anonymous"), fall back to the beatmap creator.
      const hasExplicitRequester = !!reqRow.requester_id ||
        (reqRow.requester_username && reqRow.requester_username.toLowerCase() !== 'anonymous');

      let requesterId = reqRow.requester_id;
      let requesterUsername = reqRow.requester_username;
      let requesterAvatar = requesterCache ? requesterCache.avatar_url : null;
      let requesterCountry = requesterCache ? requesterCache.country_code : null;
      let requesterIsCreator = false;

      if (requesterId && userMap.get(requesterId)?.username) {
        requesterUsername = userMap.get(requesterId).username;
      }

      if (!hasExplicitRequester && reqRow.is_osu_link && reqRow.cache_creator) {
        const creatorCache = reqRow.cache_creator_id ? userMap.get(reqRow.cache_creator_id) : null;
        requesterId = reqRow.cache_creator_id || null;
        requesterUsername = creatorCache?.username || reqRow.cache_creator;
        requesterAvatar = creatorCache ? creatorCache.avatar_url : null;
        requesterCountry = creatorCache ? creatorCache.country_code : null;
        requesterIsCreator = true;
      } else if (!hasExplicitRequester && !reqRow.is_osu_link && reqRow.non_osu_creator) {
        requesterId = null;
        requesterUsername = reqRow.non_osu_creator;
        requesterAvatar = null;
        requesterCountry = null;
      }

      return {
        id: reqRow.id,
        beatmapset_id: reqRow.beatmapset_id,
        is_osu_link: !!reqRow.is_osu_link,
        artist: reqRow.is_osu_link ? reqRow.cache_artist : reqRow.non_osu_artist,
        title: reqRow.is_osu_link ? reqRow.cache_title : reqRow.non_osu_title,
        creator: reqRow.is_osu_link ? (userMap.get(reqRow.cache_creator_id)?.username || reqRow.cache_creator) : reqRow.non_osu_creator,
        creator_id: reqRow.is_osu_link ? reqRow.cache_creator_id : null,
        creator_aliases: reqRow.is_osu_link ? (aliasesByUser.get(reqRow.cache_creator_id) || []) : [],
        difficulty_name: reqRow.is_osu_link ? '' : reqRow.non_osu_difficulty,
        cover_url: reqRow.cover_url,
        local_cover_path: reqRow.local_cover_path || '/uploads/covers/default.jpg',
        ranked_status: reqRow.is_osu_link ? reqRow.ranked_status : 'Manual',
        metadata_complete: !reqRow.is_osu_link || !!reqRow.metadata_complete,
        metadata_sync_status: reqRow.is_osu_link
          ? (reqRow.metadata_sync_status || (reqRow.metadata_complete ? 'Completed' : 'Pending'))
          : 'Completed',
        metadata_sync_error: reqRow.metadata_sync_error || null,
        requester_id: requesterId,
        requester_username: requesterUsername,
        requester_aliases: requesterId ? (aliasesByUser.get(requesterId) || []) : [],
        requester_avatar: requesterAvatar,
        requester_country: requesterCountry,
        requester_is_creator: requesterIsCreator,
        requester_profile_link: requesterIsCreator && requesterId ? `https://osu.ppy.sh/users/${requesterId}` : reqRow.osu_profile_link,
        request_status: reqRow.request_status,
        priority: reqRow.priority,
        deadline: reqRow.deadline,
        notes: reqRow.notes,
        input_link: reqRow.input_link,
        discord_link: reqRow.discord_link,
        osu_profile_link: reqRow.osu_profile_link,
        added_date: reqRow.added_date,
        completed_date: reqRow.completed_date,
        last_updated: reqRow.last_updated,
        categories,
        tags,
        highest_stars: highestStars,
        search_difficulties: difficulties,
        num_difficulties: numDifficulties,
        // Guest difficulty info
        highest_guest_stars: highestGuestStars,
        guest_difficulty_count: guestDifficultyCount,
        guest_difficulty_target_sr: reqRow.guest_difficulty_target_sr,
        guest_difficulty_name: reqRow.guest_difficulty_name,
        guest_difficulties: assignedGuestDifficulties,
        my_guest_difficulties: userDifficulties,
        my_guest_highest_stars: myGuestHighestStars,
        gamemodes: [...new Set(userDifficulties.map(difficulty => normalizeGamemode(difficulty.mode)))],
        user_difficulty: userDifficulties[0] || null
      };
    });

    // Apply Filters in memory
    let filtered = formattedRequests;

    // Search filter
    if (req.query.search) {
      const search = req.query.search.toLowerCase();
      filtered = filtered.filter(r => 
        (r.title && r.title.toLowerCase().includes(search)) ||
        (r.artist && r.artist.toLowerCase().includes(search)) ||
        (r.creator && r.creator.toLowerCase().includes(search)) ||
        (r.requester_username && r.requester_username.toLowerCase().includes(search)) ||
        (r.notes && r.notes.toLowerCase().includes(search)) ||
        r.tags.some(t => t.toLowerCase().includes(search)) ||
        (r.beatmapset_id && r.beatmapset_id.toString().includes(search))
      );
    }

    // Category filter
    if (req.query.category && req.query.category !== 'All') {
      const cat = req.query.category;
      filtered = filtered.filter(r => r.categories.some(c => c.category_name === cat));
    }

    // Status filter
    if (req.query.status) {
      filtered = filtered.filter(r => r.request_status === req.query.status);
    }

    // Priority filter
    if (req.query.priority) {
      filtered = filtered.filter(r => r.priority === req.query.priority);
    }

    // Tag filter
    if (req.query.tag) {
      filtered = filtered.filter(r => r.tags.includes(req.query.tag));
    }

    // Sorting
    if (req.query.sortBy) {
      const sortBy = req.query.sortBy;
      const order = req.query.order === 'asc' ? 1 : -1;

      filtered.sort((a, b) => {
        let valA = a[sortBy];
        let valB = b[sortBy];

        // Handle string comparison / dates / numbers
        if (sortBy === 'added_date' || sortBy === 'deadline' || sortBy === 'completed_date' || sortBy === 'last_updated') {
          valA = valA ? new Date(valA) : (order === 1 ? new Date(9999, 11) : new Date(0));
          valB = valB ? new Date(valB) : (order === 1 ? new Date(9999, 11) : new Date(0));
        } else if (typeof valA === 'string') {
          valA = valA.toLowerCase();
          valB = valB.toLowerCase();
        }

        if (valA < valB) return -1 * order;
        if (valA > valB) return 1 * order;
        return 0;
      });
    }

    res.json(filtered);
  } catch (error) {
    next(error);
  }
});

// POST /api/requests - create request
router.post('/', async (req, res, next) => {
  try {
    const {
      link,
      artist,
      title,
      creator,
      difficulty,
      notes,
      categories, // Array: [{name: 'Hitsounds', status: 'Pending'}, {name: 'Others', other_text: 'Storyboard', status: 'Working'}]
      priority = 'Low',
      deadline,
      requester_username,
      non_osu_artist,
      non_osu_title,
      non_osu_creator,
      non_osu_difficulty,
      osu_profile_link,
      input_link,
      discord_link,
      tags = [],
      force = false,
      add_to_existing_id = null,
      guest_difficulty_target_sr,
      guest_difficulty_name,
      guest_difficulties,
    } = req.body;

    const db = await getDatabase();
    const normalizedCategories = await normalizeCategories(db, categories || []);
    const normalizedGuestRows = normalizeGuestDifficulties(guest_difficulties, {
      guest_difficulty_target_sr,
      guest_difficulty_name,
      guest_difficulties,
    });
    const parsedLink = parseOsuLink(link);

    let beatmapsetId = null;
    let isOsuLink = false;

    // Handle existing duplicate add categories
    if (add_to_existing_id) {
      const existing = await db.get('SELECT * FROM requests WHERE id = ?', add_to_existing_id);
      if (!existing) {
        return res.status(404).json({ error: 'Request not found' });
      }

      await db.exec('BEGIN TRANSACTION');
      try {
      // Add categories
      for (const cat of normalizedCategories) {
        // Check if category already exists for this request
        const dupCat = await db.get(
          'SELECT id FROM request_categories WHERE request_id = ? AND category_id = ?',
          existing.id, cat.id
        );
        if (!dupCat) {
          await db.run(`
            INSERT INTO request_categories (request_id, category_id, category_name, other_text, status)
            VALUES (?, ?, ?, ?, ?)
          `, [existing.id, cat.id, cat.name, cat.other_text || null, cat.status || 'Pending']);
        }
      }

      await db.run('INSERT INTO history (request_id, action_type, details) VALUES (?, ?, ?)',
        existing.id, 'category_added', `Added categories: ${normalizedCategories.map(c => c.name).join(', ')}`
      );

      await db.exec('COMMIT');

      return res.json({ success: true, message: 'Categories added to existing request', requestId: existing.id });
      } catch (error) {
        await db.exec('ROLLBACK').catch(() => {});
        throw error;
      }
    }

    if (parsedLink) {
      isOsuLink = true;
      if (parsedLink.type === 'beatmapset') {
        beatmapsetId = parsedLink.id;
      } else {
        // It's a beatmap link, fetch to get the beatmapset ID
        console.log(`Pasted individual beatmap link. Fetching map details for ID ${parsedLink.id}...`);
        const mapData = await fetchBeatmap(parsedLink.id);
        if (mapData && mapData.beatmapset_id) {
          beatmapsetId = mapData.beatmapset_id;
        } else {
          return res.status(400).json({ error: 'Could not resolve beatmapset ID from osu! link' });
        }
      }

      // Duplicate Check
      if (!force) {
        const existingRequest = await db.get('SELECT id FROM requests WHERE beatmapset_id = ?', beatmapsetId);
        if (existingRequest) {
          return res.status(409).json({
            error: 'duplicate',
            message: 'This beatmap already exists. Add another request category?',
            requestId: existingRequest.id
          });
        }
      }

      // Make sure beatmap is fetched and cached
      try {
        await refreshAndCacheBeatmapset(db, beatmapsetId);
      } catch (err) {
        return res.status(400).json({ error: `Failed to fetch beatmap metadata from osu! API: ${err.message}` });
      }
    }

    // Resolve the requester from the username. The profile link is retained as
    // a derived database value for existing UI integrations, not as a form input.
    let requesterId = null;
    const requestedUsername = String(requester_username || '').trim();
    const isAnonymousRequester = !isOsuLink && (!requestedUsername || requestedUsername.toLowerCase() === 'anonymous');
    let finalRequesterUsername = !isOsuLink && isAnonymousRequester
      ? (String(creator || '').trim() || 'Anonymous')
      : (requestedUsername || 'Anonymous');
    let finalOsuProfileLink = osu_profile_link || null;
    
    const parsedUserLink = !isAnonymousRequester ? parseOsuUserLink(osu_profile_link) : null;
    if (parsedUserLink) {
      requesterId = parsedUserLink;
      const cachedUser = await fetchAndCacheUser(db, requesterId);
      if (cachedUser) {
        finalRequesterUsername = cachedUser.username;
        finalOsuProfileLink = `https://osu.ppy.sh/users/${cachedUser.id}`;
      }
    } else if (!isAnonymousRequester && /^\d+$/.test(requestedUsername)) {
      // Username is a numeric ID
      requesterId = parseInt(requestedUsername, 10);
      const cachedUser = await fetchAndCacheUser(db, requesterId);
      if (cachedUser) {
        finalRequesterUsername = cachedUser.username;
        finalOsuProfileLink = `https://osu.ppy.sh/users/${cachedUser.id}`;
      }
    } else if (!isAnonymousRequester && requestedUsername) {
      const cachedUser = await fetchAndCacheUser(db, requestedUsername);
      if (cachedUser) {
        requesterId = cachedUser.id;
        finalRequesterUsername = cachedUser.username;
        finalOsuProfileLink = `https://osu.ppy.sh/users/${cachedUser.id}`;
      }
    }

    // Persist the request and all child rows atomically.
    await db.exec('BEGIN TRANSACTION');
    try {
    const result = await db.run(`
      INSERT INTO requests (
        beatmapset_id, is_osu_link, non_osu_artist, non_osu_title, non_osu_creator, non_osu_difficulty,
        requester_id, requester_username, request_status, priority, deadline, notes, input_link, discord_link, osu_profile_link,
        guest_difficulty_target_sr
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      beatmapsetId,
      isOsuLink ? 1 : 0,
      isOsuLink ? null : artist,
      isOsuLink ? null : title,
      isOsuLink ? null : creator,
      isOsuLink ? null : difficulty,
      requesterId,
      finalRequesterUsername,
      'Accepted',
      priority,
      deadline || null,
      notes || null,
      isOsuLink ? null : (input_link || link || null),
      discord_link || null,
      finalOsuProfileLink,
      guest_difficulty_target_sr || null
    ]);

    const requestId = result.lastID;

    // Insert Categories
    if (normalizedCategories.length > 0) {
      for (const cat of normalizedCategories) {
        await db.run(`
          INSERT INTO request_categories (request_id, category_id, category_name, other_text, status)
          VALUES (?, ?, ?, ?, ?)
        `, [requestId, cat.id, cat.name, cat.other_text || null, cat.status || 'Pending']);
      }
    }

    await replaceGuestDifficulties(db, requestId, normalizedGuestRows);

    // Insert Tags
    if (tags && tags.length > 0) {
      for (const tagName of tags) {
        const cleanTag = tagName.trim();
        if (!cleanTag) continue;
        
        const tagRow = await ensureTag(db, cleanTag);
        if (tagRow) {
          await db.run('INSERT OR IGNORE INTO request_tags (request_id, tag_id) VALUES (?, ?)', requestId, tagRow.id);
        }
      }
    }

    // Log History
    await db.run(`
      INSERT INTO history (request_id, action_type, details)
      VALUES (?, ?, ?)
    `, [requestId, 'created', 'Request created manually']);

    await db.exec('COMMIT');

    res.status(201).json({
      success: true,
      requestId,
      message: 'Request created successfully'
    });
    } catch (error) {
      await db.exec('ROLLBACK').catch(() => {});
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

function normalizedRequestIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(id => Number(id))
    .filter(id => Number.isSafeInteger(id) && id > 0))];
}

const MAX_BULK_REQUESTS = 400;

// PATCH /api/requests/bulk - update one field or category operation for many requests.
router.patch('/bulk', async (req, res, next) => {
  const ids = normalizedRequestIds(req.body.ids);
  if (ids.length === 0) return res.status(400).json({ error: 'Select at least one valid request.' });
  if (ids.length > MAX_BULK_REQUESTS) return res.status(400).json({ error: `Bulk updates support up to ${MAX_BULK_REQUESTS} requests per batch.` });

  const placeholders = ids.map(() => '?').join(',');
  const db = await getDatabase();
  let transactionStarted = false;
  try {
    await db.exec('BEGIN TRANSACTION');
    transactionStarted = true;
    let updated = 0;

    if (req.body.request_status !== undefined) {
      const status = req.body.request_status;
      if (!['Accepted', 'Considering', 'Working', 'Completed', 'Cancelled'].includes(status)) {
        await db.exec('ROLLBACK');
        transactionStarted = false;
        return res.status(400).json({ error: 'Invalid request status.' });
      }
      const oldRows = await db.all(
        `SELECT id, request_status, beatmapset_id FROM requests WHERE id IN (${placeholders}) AND request_status <> ?`,
        ...ids, status
      );
      const update = await db.run(`
        UPDATE requests
        SET request_status = ?,
            completed_date = CASE WHEN ? = 'Completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
            last_updated = CURRENT_TIMESTAMP
        WHERE id IN (${placeholders}) AND request_status <> ?
      `, status, status, ...ids, status);
      updated = update.changes || 0;
      for (const row of oldRows) {
        await db.run(
          'INSERT INTO history (request_id, action_type, details) VALUES (?, ?, ?)',
          row.id, 'status_change', `Status changed: ${row.request_status} -> ${status}`
        );
      }

      await db.exec('COMMIT');
      transactionStarted = false;

      const refreshCandidates = await db.all(`
        SELECT DISTINCT r.beatmapset_id
        FROM requests r
        JOIN beatmap_cache b ON b.beatmapset_id = r.beatmapset_id
        WHERE r.id IN (${placeholders})
          AND lower(b.ranked_status) IN ('pending', 'wip', 'graveyard')
      `, ...ids);
      if (refreshCandidates.length > 0) {
        const { enqueueBeatmapRefresh } = require('../services/beatmapMetadataSync');
        for (const row of refreshCandidates) {
          await enqueueBeatmapRefresh(db, row.beatmapset_id);
        }
      }
      return res.json({ success: true, updated });
    }

    if (req.body.add_tags !== undefined) {
      const tagNames = Array.isArray(req.body.add_tags)
        ? [...new Set(req.body.add_tags.map(tag => String(tag || '').trim()).filter(Boolean))]
        : [];
      if (tagNames.length === 0) {
        await db.exec('ROLLBACK');
        transactionStarted = false;
        return res.status(400).json({ error: 'Provide at least one tag to add.' });
      }
      const changedRequests = new Set();
      for (const tagName of tagNames.slice(0, 50)) {
        const tag = await ensureTag(db, tagName);
        for (const requestId of ids) {
          const insertion = await db.run(
            'INSERT OR IGNORE INTO request_tags (request_id, tag_id) VALUES (?, ?)',
            requestId, tag.id
          );
          if (insertion.changes) changedRequests.add(requestId);
        }
      }
      updated = changedRequests.size;
      for (const requestId of changedRequests) {
        await db.run(
          'INSERT INTO history (request_id, action_type, details) VALUES (?, ?, ?)',
          requestId, 'bulk_tags_added', `Tags added: ${tagNames.join(', ')}`
        );
      }
    } else if (req.body.priority !== undefined) {
      const priority = req.body.priority;
      if (!['Low', 'Medium', 'High'].includes(priority)) {
        await db.exec('ROLLBACK');
        transactionStarted = false;
        return res.status(400).json({ error: 'Invalid priority.' });
      }
      const oldRows = await db.all(
        `SELECT id, priority FROM requests WHERE id IN (${placeholders}) AND priority <> ?`,
        ...ids, priority
      );
      const update = await db.run(
        `UPDATE requests SET priority = ?, last_updated = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND priority <> ?`,
        priority, ...ids, priority
      );
      updated = update.changes || 0;
      for (const row of oldRows) {
        await db.run(
          'INSERT INTO history (request_id, action_type, details) VALUES (?, ?, ?)',
          row.id, 'priority_change', `Priority updated: ${row.priority} -> ${priority}`
        );
      }
    } else if (req.body.categoryName !== undefined || req.body.categoryId !== undefined) {
      const category = await resolveCategory(db, {
        category_id: req.body.categoryId,
        name: req.body.categoryName,
      });
      const categoryName = category.name;
      const mode = req.body.mode === 'add' ? 'add' : 'move';
      if (mode === 'move') {
        await db.run(
          `DELETE FROM request_categories WHERE request_id IN (${placeholders}) AND (category_id IS NULL OR category_id <> ?)`,
          ...ids, category.id
        );
      }
      const insert = await db.run(`
        INSERT INTO request_categories (request_id, category_id, category_name, other_text, status)
        SELECT r.id, ?, ?, NULL, 'Pending'
        FROM requests r
        WHERE r.id IN (${placeholders})
          AND NOT EXISTS (
            SELECT 1 FROM request_categories c
            WHERE c.request_id = r.id AND c.category_id = ?
          )
      `, category.id, categoryName, ...ids, category.id);
      updated = mode === 'move' ? ids.length : (insert.changes || 0);
      await db.run(`
        INSERT INTO history (request_id, action_type, details)
        SELECT id, 'bulk_category_change', ? FROM requests WHERE id IN (${placeholders})
      `, `${mode === 'move' ? 'Moved to' : 'Added to'} category: ${categoryName}`, ...ids);
    } else {
      await db.exec('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'No supported bulk update was provided.' });
    }

    await db.exec('COMMIT');
    transactionStarted = false;
    res.json({ success: true, updated });
  } catch (error) {
    if (transactionStarted) await db.exec('ROLLBACK').catch(() => {});
    next(error);
  }
});

// DELETE /api/requests/bulk - delete many requests in one transaction.
router.delete('/bulk', async (req, res, next) => {
  const ids = normalizedRequestIds(req.body.ids);
  if (ids.length === 0) return res.status(400).json({ error: 'Select at least one valid request.' });
  if (ids.length > MAX_BULK_REQUESTS) return res.status(400).json({ error: `Bulk deletes support up to ${MAX_BULK_REQUESTS} requests per batch.` });

  const placeholders = ids.map(() => '?').join(',');
  const db = await getDatabase();
  let transactionStarted = false;
  try {
    const beatmapRows = await db.all(
      `SELECT DISTINCT beatmapset_id FROM requests WHERE id IN (${placeholders}) AND beatmapset_id IS NOT NULL`,
      ...ids
    );
    await db.exec('BEGIN TRANSACTION');
    transactionStarted = true;
    const result = await db.run(`DELETE FROM requests WHERE id IN (${placeholders})`, ...ids);
    for (const row of beatmapRows) {
      await db.run(`
        DELETE FROM beatmap_metadata_sync
        WHERE beatmapset_id = ? AND NOT EXISTS (
          SELECT 1 FROM requests WHERE beatmapset_id = ?
        )
      `, row.beatmapset_id, row.beatmapset_id);
    }
    await db.exec('COMMIT');
    transactionStarted = false;
    res.json({ success: true, deleted: result.changes || 0 });
  } catch (error) {
    if (transactionStarted) await db.exec('ROLLBACK').catch(() => {});
    next(error);
  }
});

// PATCH /api/requests/:id - update request details and categories
router.patch('/:id', async (req, res, next) => {
  let db;
  let transactionStarted = false;
  try {
    const requestId = parseInt(req.params.id, 10);
    const {
      request_status,
      priority,
      deadline,
      added_date,
      guest_difficulty_target_sr,
      guest_difficulty_name,
      guest_difficulties,
      notes,
      discord_link,
      osu_profile_link,
      requester_username,
      non_osu_artist,
      non_osu_title,
      non_osu_creator,
      non_osu_difficulty,
      categories, // Array of category objects to overwrite/update
      tags // Array of tags to replace existing tags
    } = req.body;

    db = await getDatabase();
    const oldRequest = await db.get('SELECT * FROM requests WHERE id = ?', requestId);
    if (!oldRequest) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const historyLogs = [];
    let refreshBeatmapsetId = null;
    await db.exec('BEGIN TRANSACTION');
    transactionStarted = true;

    // Check status change
    if (request_status && request_status !== oldRequest.request_status) {
      historyLogs.push({
        action: 'status_change',
        details: `Status changed: ${oldRequest.request_status} -> ${request_status}`
      });

      // Update completed date if changed to Completed
      const completedDate = request_status === 'Completed' ? new Date().toISOString() : null;
      
      await db.run(
        'UPDATE requests SET request_status = ?, completed_date = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?',
        request_status, completedDate, requestId
      );

      // Rule: Pending/WIP beatmap caches are updated on request status change
      if (oldRequest.is_osu_link && oldRequest.beatmapset_id) {
        const cachedMap = await db.get('SELECT ranked_status FROM beatmap_cache WHERE beatmapset_id = ?', oldRequest.beatmapset_id);
        if (cachedMap) {
          const mapStatus = cachedMap.ranked_status.toLowerCase();
          if (mapStatus === 'pending' || mapStatus === 'wip' || mapStatus === 'graveyard') {
            refreshBeatmapsetId = oldRequest.beatmapset_id;
          }
        }
      }
    }

    // Check priority change
    if (priority && priority !== oldRequest.priority) {
      historyLogs.push({
        action: 'priority_change',
        details: `Priority updated: ${oldRequest.priority} -> ${priority}`
      });
      await db.run('UPDATE requests SET priority = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?', priority, requestId);
    }

    const normalizedDeadline = deadline === undefined || deadline === null || deadline === '' || deadline === 0 || deadline === '0' ? null : deadline;
    const normalizedAddedDate = added_date === undefined || added_date === null || added_date === '' || added_date === 0 || added_date === '0' ? null : added_date;

    // Check deadline change
    if (deadline !== undefined && normalizedDeadline !== oldRequest.deadline) {
      const oldDeadlineStr = oldRequest.deadline ? oldRequest.deadline : 'None';
      const newDeadlineStr = normalizedDeadline ? normalizedDeadline : 'None';
      historyLogs.push({
        action: 'deadline_change',
        details: `Deadline updated: ${oldDeadlineStr} -> ${newDeadlineStr}`
      });
      await db.run('UPDATE requests SET deadline = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?', normalizedDeadline, requestId);
    }

    // Update notes
    if (notes !== undefined && notes !== oldRequest.notes) {
      await db.run('UPDATE requests SET notes = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?', notes, requestId);
    }

    // Update links
    if (discord_link !== undefined && discord_link !== oldRequest.discord_link) {
      await db.run('UPDATE requests SET discord_link = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?', discord_link, requestId);
    }

    if (osu_profile_link !== undefined && osu_profile_link !== oldRequest.osu_profile_link) {
      await db.run('UPDATE requests SET osu_profile_link = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?', osu_profile_link, requestId);
      // Auto cache requester profile if updated
      const parsedUserLink = parseOsuUserLink(osu_profile_link);
      if (parsedUserLink && parsedUserLink !== oldRequest.requester_id) {
        const cachedUser = await fetchAndCacheUser(db, parsedUserLink);
        const finalUsername = cachedUser ? cachedUser.username : oldRequest.requester_username;
        await db.run(
          'UPDATE requests SET requester_id = ?, requester_username = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?',
          parsedUserLink, finalUsername, requestId
        );
      }
    }

    // Update added_date
    if (added_date !== undefined && normalizedAddedDate !== oldRequest.added_date) {
      const oldDate = oldRequest.added_date ? new Date(oldRequest.added_date).toLocaleDateString() : 'None';
      const newDate = normalizedAddedDate ? new Date(normalizedAddedDate).toLocaleDateString() : 'None';
      historyLogs.push({
        action: 'added_date_change',
        details: `Added date updated: ${oldDate} -> ${newDate}`
      });
      await db.run('UPDATE requests SET added_date = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?', normalizedAddedDate, requestId);
    }

    if (non_osu_artist !== undefined || non_osu_title !== undefined || non_osu_creator !== undefined || non_osu_difficulty !== undefined || requester_username !== undefined) {
      await db.run(`UPDATE requests SET non_osu_artist = COALESCE(?, non_osu_artist), non_osu_title = COALESCE(?, non_osu_title), non_osu_creator = COALESCE(?, non_osu_creator), non_osu_difficulty = ?, requester_username = COALESCE(?, requester_username), last_updated = CURRENT_TIMESTAMP WHERE id = ?`, non_osu_artist, non_osu_title, non_osu_creator, non_osu_difficulty ?? null, requester_username, requestId);
    }

    // Update guest_difficulty_target_sr
    if (guest_difficulty_target_sr !== undefined && guest_difficulty_target_sr !== oldRequest.guest_difficulty_target_sr) {
      historyLogs.push({
        action: 'guest_difficulty_target_sr_change',
        details: `Guest Difficulty target SR updated: ${oldRequest.guest_difficulty_target_sr || 'None'} -> ${guest_difficulty_target_sr || 'None'}`
      });
      await db.run('UPDATE requests SET guest_difficulty_target_sr = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?', guest_difficulty_target_sr, requestId);
    }

    // Update guest_difficulty_name (manual assignment for unmatched GDs)
    if (guest_difficulty_name !== undefined && guest_difficulty_name !== oldRequest.guest_difficulty_name) {
      historyLogs.push({
        action: 'guest_difficulty_name_change',
        details: `Guest Difficulty name assignment: ${oldRequest.guest_difficulty_name || 'None'} -> ${guest_difficulty_name || 'None'}`
      });
      await db.run('UPDATE requests SET guest_difficulty_name = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?', guest_difficulty_name || null, requestId);
    }

    if (guest_difficulties !== undefined) {
      const oldRows = await db.all(
        'SELECT * FROM request_guest_difficulties WHERE request_id = ? ORDER BY sort_order, id',
        requestId
      );
      const nextRows = normalizeGuestDifficulties(guest_difficulties);
      await replaceGuestDifficulties(db, requestId, nextRows);
      const comparableOldRows = oldRows.map(row => ({
        beatmap_id: row.beatmap_id,
        difficulty_name: row.difficulty_name,
        gamemode: row.gamemode,
        target_sr: row.target_sr,
        sort_order: row.sort_order,
      }));
      const sharedCount = Math.min(comparableOldRows.length, nextRows.length);
      const edited = Array.from({ length: sharedCount }, (_, index) => index)
        .filter(index => JSON.stringify(comparableOldRows[index]) !== JSON.stringify(nextRows[index])).length;
      const added = Math.max(0, nextRows.length - comparableOldRows.length);
      const removed = Math.max(0, comparableOldRows.length - nextRows.length);
      if (added) {
        historyLogs.push({ action: 'guest_difficulties_added', details: `${added} guest difficult${added === 1 ? 'y' : 'ies'} added.` });
      }
      if (removed) {
        historyLogs.push({ action: 'guest_difficulties_removed', details: `${removed} guest difficult${removed === 1 ? 'y' : 'ies'} removed.` });
      }
      if (edited) {
        historyLogs.push({
          action: 'guest_difficulties_edited',
          details: `${edited} guest difficult${edited === 1 ? 'y' : 'ies'} edited.`
        });
      }
    } else if (guest_difficulty_target_sr !== undefined || guest_difficulty_name !== undefined) {
      const compatibilityRows = normalizeGuestDifficulties([], {
        guest_difficulty_target_sr: guest_difficulty_target_sr !== undefined
          ? guest_difficulty_target_sr
          : oldRequest.guest_difficulty_target_sr,
        guest_difficulty_name: guest_difficulty_name !== undefined
          ? guest_difficulty_name
          : oldRequest.guest_difficulty_name,
      });
      await replaceGuestDifficulties(db, requestId, compatibilityRows);
    }

    // Update Categories
    if (categories) {
      // We will update the categories matching the request ID
      const oldCats = await db.all('SELECT * FROM request_categories WHERE request_id = ?', requestId);
      const nextCategories = await normalizeCategories(db, categories, { activeOnly: false });

      for (const cat of nextCategories) {
        const matched = oldCats.find(c => c.category_id === cat.id || c.category_name.toLowerCase() === cat.name.toLowerCase());
        if (matched) {
          const nextStatus = cat.status || matched.status || 'Pending';
          if (matched.status !== nextStatus || matched.other_text !== cat.other_text) {
            historyLogs.push({
              action: 'category_status_change',
              details: `${cat.name} status: ${matched.status} -> ${nextStatus}`
            });
            await db.run(
              'UPDATE request_categories SET category_id = ?, category_name = ?, status = ?, other_text = ? WHERE id = ?',
              cat.id, cat.name, nextStatus, cat.other_text || null, matched.id
            );
          }
        } else {
          // New category added
          await db.run(
            'INSERT INTO request_categories (request_id, category_id, category_name, other_text, status) VALUES (?, ?, ?, ?, ?)',
            requestId, cat.id, cat.name, cat.other_text || null, cat.status || 'Pending'
          );
          historyLogs.push({
            action: 'category_added',
            details: `Category added: ${cat.name} (${cat.status})`
          });
        }
      }

      // Check if any old category was removed
      for (const oldCat of oldCats) {
        if (!nextCategories.some(c => c.id === oldCat.category_id || c.name.toLowerCase() === oldCat.category_name.toLowerCase())) {
          await db.run('DELETE FROM request_categories WHERE id = ?', oldCat.id);
          historyLogs.push({
            action: 'category_removed',
            details: `Category removed: ${oldCat.category_name}`
          });
        }
      }
    }

    // Update Tags
    if (tags) {
      // Remove old request tags
      await db.run('DELETE FROM request_tags WHERE request_id = ?', requestId);
      // Re-insert new tags
      for (const tagName of tags) {
        const cleanTag = tagName.trim();
        if (!cleanTag) continue;

        const tagRow = await ensureTag(db, cleanTag);
        if (tagRow) {
          await db.run('INSERT OR IGNORE INTO request_tags (request_id, tag_id) VALUES (?, ?)', requestId, tagRow.id);
        }
      }
    }

    // Write history records
    for (const log of historyLogs) {
      await db.run(
        'INSERT INTO history (request_id, action_type, details) VALUES (?, ?, ?)',
        requestId, log.action, log.details
      );
    }

    await db.exec('COMMIT');
    transactionStarted = false;
    if (refreshBeatmapsetId) {
      try {
        const { enqueueBeatmapRefresh } = require('../services/beatmapMetadataSync');
        await enqueueBeatmapRefresh(db, refreshBeatmapsetId);
      } catch (error) {
        console.error('Failed to enqueue beatmap refresh after request status change:', error.message);
      }
    }
    res.json({ success: true, message: 'Request updated successfully' });
  } catch (error) {
    if (transactionStarted) await db.exec('ROLLBACK').catch(() => {});
    next(error);
  }
});

// POST /api/requests/:id/link-beatmap - Convert one manual request into an
// osu!-linked request while preserving its request workflow and child records.
router.post('/:id/link-beatmap', async (req, res, next) => {
  try {
    const requestId = Number.parseInt(req.params.id, 10);
    const parsedLink = parseOsuLink(req.body?.link);
    if (!Number.isSafeInteger(requestId) || !parsedLink) {
      return res.status(400).json({ error: 'Provide a valid osu! beatmap or beatmapset link.' });
    }

    const db = await getDatabase();
    const request = await db.get('SELECT * FROM requests WHERE id = ?', requestId);
    if (!request) return res.status(404).json({ error: 'Request not found.' });
    if (request.is_osu_link) return res.status(409).json({ error: 'This request is already linked to an osu! beatmap.' });

    let beatmapsetId = parsedLink.id;
    if (parsedLink.type === 'beatmap') {
      const beatmap = await fetchBeatmap(parsedLink.id);
      if (!beatmap?.beatmapset_id) return res.status(400).json({ error: 'Could not resolve the beatmapset from that link.' });
      beatmapsetId = beatmap.beatmapset_id;
    }

    const duplicate = await db.get('SELECT id FROM requests WHERE beatmapset_id = ? AND id <> ?', beatmapsetId, requestId);
    if (duplicate) {
      return res.status(409).json({ error: 'That beatmapset is already linked to another request.', requestId: duplicate.id });
    }

    // Do all network validation before changing the manual request.
    const metadata = await refreshAndCacheBeatmapset(db, beatmapsetId);
    await db.exec('BEGIN TRANSACTION');
    try {
      await db.run(`
        UPDATE requests SET
          beatmapset_id = ?, is_osu_link = 1,
          non_osu_artist = NULL, non_osu_title = NULL, non_osu_creator = NULL, non_osu_difficulty = NULL,
          input_link = NULL, last_updated = CURRENT_TIMESTAMP
        WHERE id = ?
      `, beatmapsetId, requestId);
      await db.run(
        'INSERT INTO history (request_id, action_type, details) VALUES (?, ?, ?)',
        [requestId, 'linked_to_beatmap', `Linked manual request to osu! beatmapset ${beatmapsetId} (${metadata.artist} - ${metadata.title}).`]
      );
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
    res.json({ success: true, beatmapset_id: beatmapsetId, message: 'Manual request linked to osu! beatmap metadata.' });
  } catch (error) {
    next(error);
  }
});

// POST /api/requests/:id/refresh-date - refresh only this request's lifecycle date.
router.post('/:id/refresh-date', async (req, res, next) => {
  try {
    const requestId = Number.parseInt(req.params.id, 10);
    const db = await getDatabase();
    const request = await db.get('SELECT id, beatmapset_id, is_osu_link, added_date FROM requests WHERE id = ?', requestId);
    if (!request) return res.status(404).json({ error: 'Request not found.' });
    if (!request.is_osu_link || !request.beatmapset_id) {
      return res.status(400).json({ error: 'Only osu!-linked requests have dates to refresh.' });
    }
    const cacheEntry = await refreshAndCacheBeatmapset(db, request.beatmapset_id);
    const dateValue = formatLifecycleDate(getEffectiveBeatmapDate(cacheEntry));
    if (!dateValue) return res.status(422).json({ error: 'osu! did not provide a usable lifecycle date for this beatmap.' });
    await db.exec('BEGIN TRANSACTION');
    try {
      await db.run('UPDATE requests SET added_date = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?', dateValue, requestId);
      await db.run(
        'INSERT INTO history (request_id, action_type, details) VALUES (?, ?, ?)',
        [requestId, 'added_date_refreshed_from_osu', `Added date refreshed from osu!: ${dateValue}`]
      );
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
    res.json({ success: true, added_date: dateValue, message: 'Added date refreshed from osu!.' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/requests/:id - delete request
router.delete('/:id', async (req, res, next) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const db = await getDatabase();
    const request = await db.get('SELECT beatmapset_id FROM requests WHERE id = ?', requestId);

    const result = await db.run('DELETE FROM requests WHERE id = ?', requestId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    if (request?.beatmapset_id) {
      await db.run(`
        DELETE FROM beatmap_metadata_sync
        WHERE beatmapset_id = ? AND NOT EXISTS (
          SELECT 1 FROM requests WHERE beatmapset_id = ?
        )
      `, request.beatmapset_id, request.beatmapset_id);
    }

    res.json({ success: true, message: 'Request deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// GET /api/requests/:id/history - get history log for modal
router.get('/:id/history', async (req, res, next) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const db = await getDatabase();
    
    const logs = await db.all('SELECT * FROM history WHERE request_id = ? ORDER BY created_at DESC', requestId);
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

// GET /api/requests/beatmap-info - fetch beatmap metadata from osu! link
router.get('/beatmap-info', async (req, res, next) => {
  try {
    const { link } = req.query;
    if (!link) {
      return res.status(400).json({ error: 'Link parameter is required' });
    }

    const parsedLink = parseOsuLink(link);
    if (!parsedLink) {
      return res.status(400).json({ error: 'Invalid osu! beatmap/beatmapset link' });
    }

    let beatmapsetId;
    if (parsedLink.type === 'beatmapset') {
      beatmapsetId = parsedLink.id;
    } else {
      // It's a beatmap link, fetch to get the beatmapset ID
      const mapData = await fetchBeatmap(parsedLink.id);
      if (mapData && mapData.beatmapset_id) {
        beatmapsetId = mapData.beatmapset_id;
      } else {
        return res.status(400).json({ error: 'Could not resolve beatmapset ID from osu! link' });
      }
    }

    // Fetch beatmapset details
    const beatmapset = await fetchBeatmapset(beatmapsetId);
    if (!beatmapset) {
      return res.status(404).json({ error: 'Beatmapset not found on osu!' });
    }

    // Fetch creator info
    const creatorInfo = await fetchUser(beatmapset.user_id);
    const difficulties = (beatmapset.beatmaps || []).map(beatmap => {
      const owners = Array.isArray(beatmap.owners) ? beatmap.owners.filter(Boolean) : [];
      const creatorIds = owners.map(owner => Number(owner.id)).filter(Number.isSafeInteger);
      const creatorNames = owners.map(owner => owner.username).filter(Boolean);
      return {
        id: beatmap.id,
        name: beatmap.version,
        mode: normalizeGamemode(beatmap.mode ?? beatmap.mode_int),
        stars: beatmap.difficulty_rating,
        creator_id: creatorIds[0] ?? beatmap.user_id ?? beatmapset.user_id,
        creator_ids: creatorIds.length > 0 ? creatorIds : [beatmap.user_id ?? beatmapset.user_id].filter(Number.isSafeInteger),
        creator_name: creatorNames[0] || beatmapset.creator,
        creator_names: creatorNames.length > 0 ? creatorNames : [beatmapset.creator].filter(Boolean),
      };
    });

    res.json({
      beatmapsetId: beatmapset.id,
      artist: beatmapset.artist,
      title: beatmapset.title,
      creator: beatmapset.creator,
      creatorId: beatmapset.user_id,
      creatorUsername: creatorInfo?.username,
      creatorAvatar: creatorInfo?.avatar_url,
      creatorCountry: creatorInfo?.country_code,
      creatorProfileUrl: creatorInfo ? `https://osu.ppy.sh/users/${creatorInfo.id}` : `https://osu.ppy.sh/users/${beatmapset.user_id}`,
      coverUrl: beatmapset.covers?.cover || `https://assets.ppy.sh/beatmaps/${beatmapset.id}/covers/cover.jpg`,
      status: beatmapset.status,
      rankedDate: beatmapset.ranked_date,
      bpm: beatmapset.bpm,
      genres: beatmapset.genres,
      language: beatmapset.language,
      difficulties,
    });
  } catch (error) {
    next(error);
  }
});

// Prefer the date that best represents a beatmap's lifecycle for request
// history: ranked/loved date for those statuses, otherwise the last-updated
// date, with the original submission date as a compatibility fallback.
function getEffectiveBeatmapDate(cacheEntry) {
  const status = (cacheEntry?.ranked_status || '').toLowerCase();
  if ((status === 'ranked' || status === 'loved') && cacheEntry.ranked_date) {
    return cacheEntry.ranked_date;
  }
  return cacheEntry?.osu_last_updated || cacheEntry?.ranked_date || cacheEntry?.submitted_date || null;
}

function formatLifecycleDate(value) {
  if (!value) return null;
  const date = String(value).split(/[ T]/)[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    ? date
    : null;
}

function createRefreshDateResult(manual = []) {
  return {
    updated: 0,
    skippedManual: manual,
    skippedNoUsableDate: [],
    failed: []
  };
}

function refreshDateJobResponse(job) {
  return {
    jobId: job.id,
    status: job.status,
    total: job.total,
    processed: job.processed,
    result: job.result
  };
}

// GET /api/requests/refresh-dates/status/:jobId - Retrieve a selected-refresh result.
router.get('/refresh-dates/status/:jobId', (req, res) => {
  pruneRefreshDateJobs();
  const job = refreshDateJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Refresh result not found or has expired.' });
  res.json(refreshDateJobResponse(job));
});

// POST /api/requests/refresh-dates - Update added_date from each beatmapset's lifecycle date
router.post('/refresh-dates', async (req, res, next) => {
  try {
    const db = await getDatabase();
    const requestedIds = Array.isArray(req.body?.ids)
      ? [...new Set(req.body.ids.map(id => Number.parseInt(id, 10)).filter(Number.isSafeInteger))]
      : null;
    if (requestedIds && requestedIds.length === 0) {
      return res.status(400).json({ error: 'Select at least one request to refresh.' });
    }

    const rowSelect = `
      SELECT r.id, r.beatmapset_id, r.is_osu_link,
             COALESCE(b.title, r.non_osu_title, 'Request ' || r.id) AS title
      FROM requests r
      LEFT JOIN beatmap_cache b ON r.beatmapset_id = b.beatmapset_id
    `;
    const rows = requestedIds
      ? await db.all(`${rowSelect} WHERE r.id IN (${requestedIds.map(() => '?').join(', ')})`, requestedIds)
      : await db.all(`${rowSelect} WHERE r.beatmapset_id IS NOT NULL`);

    if (rows.length === 0) {
      return res.json({ success: true, message: 'No osu! link requests found to update.' });
    }

    const manual = rows
      .filter(row => !row.is_osu_link || !row.beatmapset_id)
      .map(row => ({ id: row.id, title: row.title }));
    const linkedRows = rows.filter(row => row.is_osu_link && row.beatmapset_id);

    // A selected refresh needs an observable completion result so the UI can
    // tell the user exactly which selected maps did not expose a usable date.
    if (requestedIds) {
      if (linkedRows.length === 0) {
        return res.json({
          success: true,
          completed: true,
          message: 'The selected requests are manual and were skipped.',
          result: createRefreshDateResult(manual)
        });
      }

      pruneRefreshDateJobs();
      const job = {
        id: `refresh-dates-${nextRefreshDateJobId++}`,
        status: 'running',
        total: linkedRows.length,
        processed: 0,
        result: createRefreshDateResult(manual),
        completedAt: null
      };
      refreshDateJobs.set(job.id, job);
      const apiJobId = createApiJob('Refreshing selected request dates', linkedRows.length);

      res.status(202).json({
        success: true,
        message: `Refreshing dates for ${linkedRows.length} selected osu!-linked request${linkedRows.length === 1 ? '' : 's'} in the background.`,
        ...refreshDateJobResponse(job)
      });

      trackBackgroundTask((async () => {
        try {
          for (const row of linkedRows) {
            try {
              const cacheEntry = await refreshAndCacheBeatmapset(db, row.beatmapset_id, apiJobId);
              const dateValue = formatLifecycleDate(getEffectiveBeatmapDate(cacheEntry));
              if (!dateValue) {
                job.result.skippedNoUsableDate.push({ id: row.id, title: row.title });
              } else {
                await db.run('UPDATE requests SET added_date = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?', [dateValue, row.id]);
                await db.run(
                  'INSERT INTO history (request_id, action_type, details) VALUES (?, ?, ?)',
                  [row.id, 'added_date_refreshed_from_osu', `Added date refreshed from osu!: ${dateValue}`]
                );
                job.result.updated++;
              }
            } catch (error) {
              console.error(`Failed to refresh selected request date for request ${row.id} (beatmapset ${row.beatmapset_id}):`, error.message);
              job.result.failed.push({ id: row.id, title: row.title });
            } finally {
              job.processed++;
            }
          }
        } finally {
          finishApiJob(apiJobId);
          job.status = 'completed';
          job.completedAt = Date.now();
        }
      })());
      return;
    }

    const apiJobId = createApiJob('Refreshing request dates', linkedRows.length);

    // Respond immediately; process in the background (throttled osu! API calls)
    res.json({
      success: true,
      message: `Refreshing request dates for ${linkedRows.length} requests in the background. This may take a while due to API rate limiting.`
    });

    trackBackgroundTask((async () => {
      let updated = 0;
      try {
        for (const row of linkedRows) {
          try {
            // Full refresh also caches the creator profile and osu! dates
            const cacheEntry = await refreshAndCacheBeatmapset(db, row.beatmapset_id, apiJobId);
            const effectiveDate = getEffectiveBeatmapDate(cacheEntry);
            if (effectiveDate) {
              await db.run(
                'UPDATE requests SET added_date = ? WHERE id = ?',
                [formatLifecycleDate(effectiveDate), row.id]
              );
              updated++;
            }
          } catch (err) {
            console.error(`Failed to refresh request date for request ${row.id} (beatmapset ${row.beatmapset_id}):`, err.message);
          }
        }
      } finally {
        finishApiJob(apiJobId);
      }
      console.log(`[refresh-dates] Updated request dates for ${updated}/${linkedRows.length} requests.`);
    })());
  } catch (error) {
    next(error);
  }
});

module.exports = router;
