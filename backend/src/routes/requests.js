const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db');
const { fetchBeatmap, fetchBeatmapset, fetchUser, downloadCover } = require('../osuApi');
const { refreshAndCacheBeatmapset } = require('./beatmaps');
const { createApiJob, updateApiJob, finishApiJob } = require('../osuApi');
const { findUserDifficulty, isGuestDifficulty, parseOsuLink, parseOsuUserLink } = require('../utils/requestUtils');
const { trackBackgroundTask } = require('../utils/backgroundTasks');

// Helper to update or cache a user profile
async function fetchAndCacheUser(db, userIdOrUsername) {
  try {
    const userData = await fetchUser(userIdOrUsername);
    if (userData) {
      await db.run(`
        INSERT OR REPLACE INTO users_cache (id, username, avatar_url, country_code, last_updated)
        VALUES (?, ?, ?, ?, ?)
      `, [
        userData.id,
        userData.username,
        userData.avatar_url,
        userData.country_code,
        new Date().toISOString()
      ]);
      return {
        id: userData.id,
        username: userData.username,
        avatar_url: userData.avatar_url,
        country_code: userData.country_code
      };
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
    const allCategories = await db.all('SELECT * FROM request_categories');
    const categoriesByRequest = new Map();
    for (const category of allCategories) {
      if (!categoriesByRequest.has(category.request_id)) categoriesByRequest.set(category.request_id, []);
      categoriesByRequest.get(category.request_id).push({
        id: category.id,
        category_name: category.category_name,
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

    // Fetch all user caches
    const usersList = await db.all('SELECT * FROM users_cache');
    const userMap = new Map(usersList.map(u => [u.id, u]));

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

      // Parse difficulties
      let difficulties = [];
      let highestStars = 0;
      let numDifficulties = 0;
      let guestDifficulties = [];
      let highestGuestStars = 0;
      let guestDifficultyCount = 0;

      if (reqRow.is_osu_link && reqRow.difficulties_json) {
        try {
          difficulties = JSON.parse(reqRow.difficulties_json);
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
      const isGuestDiffRequest = categories.some(c => c.category_name === 'Guest Difficulties');
      let userDifficulty = null;
      
      if (isGuestDiffRequest) {
        // Find if there's any difficulty belonging to the connected user
        if (reqRow.is_osu_link && difficulties.length > 0) {
          userDifficulty = findUserDifficulty(difficulties, {
            connectedUserId,
            connectedUsername,
            assignedName: reqRow.guest_difficulty_name,
          });
        }
        
        if (userDifficulty) {
          highestStars = userDifficulty.stars;
        } else {
          // Fallback to target SR
          highestStars = reqRow.guest_difficulty_target_sr || 0;
        }
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

      if (!hasExplicitRequester && reqRow.is_osu_link && reqRow.cache_creator) {
        const creatorCache = reqRow.cache_creator_id ? userMap.get(reqRow.cache_creator_id) : null;
        requesterId = reqRow.cache_creator_id || null;
        requesterUsername = reqRow.cache_creator;
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
        creator: reqRow.is_osu_link ? reqRow.cache_creator : reqRow.non_osu_creator,
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
        num_difficulties: numDifficulties,
        // Guest difficulty info
        highest_guest_stars: highestGuestStars,
        guest_difficulty_count: guestDifficultyCount,
        guest_difficulty_target_sr: reqRow.guest_difficulty_target_sr,
        guest_difficulty_name: reqRow.guest_difficulty_name,
        user_difficulty: userDifficulty || null
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
      guest_difficulty_target_sr
    } = req.body;

    const db = await getDatabase();
    const parsedLink = parseOsuLink(link);

    let beatmapsetId = null;
    let isOsuLink = false;

    // Handle existing duplicate add categories
    if (add_to_existing_id) {
      const existing = await db.get('SELECT * FROM requests WHERE id = ?', add_to_existing_id);
      if (!existing) {
        return res.status(404).json({ error: 'Request not found' });
      }

      // Add categories
      for (const cat of categories) {
        // Check if category already exists for this request
        const dupCat = await db.get(
          'SELECT id FROM request_categories WHERE request_id = ? AND category_name = ?',
          existing.id, cat.name
        );
        if (!dupCat) {
          await db.run(`
            INSERT INTO request_categories (request_id, category_name, other_text, status)
            VALUES (?, ?, ?, ?)
          `, [existing.id, cat.name, cat.other_text || null, cat.status || 'Pending']);
        }
      }

      await db.run('INSERT INTO history (request_id, action_type, details) VALUES (?, ?, ?)',
        existing.id, 'category_added', `Added categories: ${categories.map(c => c.name).join(', ')}`
      );

      return res.json({ success: true, message: 'Categories added to existing request', requestId: existing.id });
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

    // Insert Request
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
    if (categories && categories.length > 0) {
      for (const cat of categories) {
        await db.run(`
          INSERT INTO request_categories (request_id, category_name, other_text, status)
          VALUES (?, ?, ?, ?)
        `, [requestId, cat.name, cat.other_text || null, cat.status || 'Pending']);
      }
    }

    // Insert Tags
    if (tags && tags.length > 0) {
      for (const tagName of tags) {
        const cleanTag = tagName.trim();
        if (!cleanTag) continue;
        
        await db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', cleanTag);
        const tagRow = await db.get('SELECT id FROM tags WHERE name = ?', cleanTag);
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

    res.status(201).json({
      success: true,
      requestId,
      message: 'Request created successfully'
    });
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

    if (req.body.priority !== undefined) {
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
    } else if (req.body.categoryName !== undefined) {
      const categoryName = req.body.categoryName;
      const mode = req.body.mode === 'add' ? 'add' : 'move';
      if (!['Hitsounds', 'Guest Difficulties', 'Storyboards', 'Others'].includes(categoryName)) {
        await db.exec('ROLLBACK');
        transactionStarted = false;
        return res.status(400).json({ error: 'Invalid request category.' });
      }
      if (mode === 'move') {
        await db.run(
          `DELETE FROM request_categories WHERE request_id IN (${placeholders}) AND category_name <> ?`,
          ...ids, categoryName
        );
      }
      const insert = await db.run(`
        INSERT INTO request_categories (request_id, category_name, other_text, status)
        SELECT r.id, ?, NULL, 'Pending'
        FROM requests r
        WHERE r.id IN (${placeholders})
          AND NOT EXISTS (
            SELECT 1 FROM request_categories c
            WHERE c.request_id = r.id AND c.category_name = ?
          )
      `, categoryName, ...ids, categoryName);
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
  try {
    const requestId = parseInt(req.params.id, 10);
    const {
      request_status,
      priority,
      deadline,
      added_date,
      guest_difficulty_target_sr,
      guest_difficulty_name,
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

    const db = await getDatabase();
    const oldRequest = await db.get('SELECT * FROM requests WHERE id = ?', requestId);
    if (!oldRequest) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const historyLogs = [];

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
            console.log(`Status changed on request with Pending/WIP/Graveyard beatmap ${oldRequest.beatmapset_id}. Refreshing metadata...`);
            try {
              await refreshAndCacheBeatmapset(db, oldRequest.beatmapset_id);
            } catch (err) {
              console.error('Failed to refresh beatmap on request status change:', err.message);
            }
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

    // Update Categories
    if (categories) {
      // We will update the categories matching the request ID
      const oldCats = await db.all('SELECT * FROM request_categories WHERE request_id = ?', requestId);
      
      for (const cat of categories) {
        const matched = oldCats.find(c => c.category_name === cat.category_name);
        if (matched) {
          const nextStatus = cat.status || matched.status || 'Pending';
          if (matched.status !== nextStatus || matched.other_text !== cat.other_text) {
            historyLogs.push({
              action: 'category_status_change',
              details: `${cat.category_name} status: ${matched.status} -> ${nextStatus}`
            });
            await db.run(
              'UPDATE request_categories SET status = ?, other_text = ? WHERE id = ?',
              nextStatus, cat.other_text || null, matched.id
            );
          }
        } else {
          // New category added
          await db.run(
            'INSERT INTO request_categories (request_id, category_name, other_text, status) VALUES (?, ?, ?, ?)',
            requestId, cat.category_name, cat.other_text || null, cat.status || 'Pending'
          );
          historyLogs.push({
            action: 'category_added',
            details: `Category added: ${cat.category_name} (${cat.status})`
          });
        }
      }

      // Check if any old category was removed
      for (const oldCat of oldCats) {
        if (!categories.some(c => c.category_name === oldCat.category_name)) {
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

        await db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', cleanTag);
        const tagRow = await db.get('SELECT id FROM tags WHERE name = ?', cleanTag);
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

    res.json({ success: true, message: 'Request updated successfully' });
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
      language: beatmapset.language
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

// POST /api/requests/refresh-dates - Update added_date from each beatmapset's lifecycle date
router.post('/refresh-dates', async (req, res, next) => {
  try {
    const db = await getDatabase();
    const rows = await db.all('SELECT id, beatmapset_id FROM requests WHERE beatmapset_id IS NOT NULL');

    if (rows.length === 0) {
      return res.json({ success: true, message: 'No osu! link requests found to update.' });
    }

    const apiJobId = createApiJob('Refreshing request dates', rows.length);

    // Respond immediately; process in the background (throttled osu! API calls)
    res.json({
      success: true,
      message: `Refreshing request dates for ${rows.length} requests in the background. This may take a while due to API rate limiting.`
    });

    trackBackgroundTask((async () => {
      let updated = 0;
      try {
        for (const row of rows) {
          try {
            // Full refresh also caches the creator profile and osu! dates
            const cacheEntry = await refreshAndCacheBeatmapset(db, row.beatmapset_id, apiJobId);
            const effectiveDate = getEffectiveBeatmapDate(cacheEntry);
            if (effectiveDate) {
              await db.run(
                'UPDATE requests SET added_date = ? WHERE id = ?',
                [effectiveDate, row.id]
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
      console.log(`[refresh-dates] Updated request dates for ${updated}/${rows.length} requests.`);
    })());
  } catch (error) {
    next(error);
  }
});

module.exports = router;
