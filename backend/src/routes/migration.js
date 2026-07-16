const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db');
const { refreshAndCacheBeatmapset } = require('./beatmaps');
const { fetchBeatmap } = require('../osuApi');
const { createApiJob, addApiJobWork, updateApiJob, finishApiJob } = require('../osuApi');
const { parseOsuLink } = require('../utils/requestUtils');

const IMPORT_CATEGORY_NAMES = new Set(['Hitsounds', 'Guest Difficulties', 'Storyboards', 'Others']);

// GET /api/migration/export - Export backup JSON
router.get('/export', async (req, res, next) => {
  try {
    const db = await getDatabase();
    
    const requests = await db.all('SELECT * FROM requests');
    const request_categories = await db.all('SELECT * FROM request_categories');
    const beatmap_cache = await db.all('SELECT * FROM beatmap_cache');
    const users_cache = await db.all('SELECT * FROM users_cache');
    const history = await db.all('SELECT * FROM history');
    const tags = await db.all('SELECT * FROM tags');
    const request_tags = await db.all('SELECT * FROM request_tags');
    const settings = await db.all('SELECT * FROM settings');

    const backup = {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      requests,
      request_categories,
      beatmap_cache,
      users_cache,
      history,
      tags,
      request_tags,
      settings
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=backup.json');
    res.json(backup);
  } catch (error) {
    next(error);
  }
});

// POST /api/migration/import-json - Restore backup JSON
router.post('/import-json', async (req, res, next) => {
  try {
    const backup = req.body;
    if (!backup || !backup.requests) {
      return res.status(400).json({ error: 'Invalid backup JSON structure' });
    }

    const db = await getDatabase();

    // Disable foreign keys temporarily during restore to avoid order constraint errors
    await db.run('PRAGMA foreign_keys = OFF');

    // Clear existing tables
    await db.run('DELETE FROM requests');
    await db.run('DELETE FROM request_categories');
    await db.run('DELETE FROM beatmap_cache');
    await db.run('DELETE FROM users_cache');
    await db.run('DELETE FROM history');
    await db.run('DELETE FROM tags');
    await db.run('DELETE FROM request_tags');
    // Keep credentials settings unless provided
    if (backup.settings && backup.settings.length > 0) {
      await db.run('DELETE FROM settings');
    }

    // Insert requests
    for (const r of backup.requests || []) {
      await db.run(`
        INSERT INTO requests (id, beatmapset_id, is_osu_link, non_osu_artist, non_osu_title, non_osu_creator, non_osu_difficulty, requester_id, requester_username, request_status, priority, deadline, notes, input_link, discord_link, osu_profile_link, added_date, completed_date, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [r.id, r.beatmapset_id, r.is_osu_link, r.non_osu_artist, r.non_osu_title, r.non_osu_creator, r.non_osu_difficulty, r.requester_id, r.requester_username, r.request_status, r.priority, r.deadline, r.notes, r.input_link || null, r.discord_link, r.osu_profile_link, r.added_date, r.completed_date, r.last_updated]);
    }

    // Insert request_categories
    for (const rc of backup.request_categories || []) {
      await db.run(`
        INSERT INTO request_categories (id, request_id, category_name, other_text, status)
        VALUES (?, ?, ?, ?, ?)
      `, [rc.id, rc.request_id, rc.category_name, rc.other_text, rc.status]);
    }

    // Insert beatmap_cache
    for (const bc of backup.beatmap_cache || []) {
      await db.run(`
        INSERT INTO beatmap_cache (beatmapset_id, artist, title, creator, creator_id, cover_url, local_cover_path, ranked_status, difficulties_json, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [bc.beatmapset_id, bc.artist, bc.title, bc.creator, bc.creator_id, bc.cover_url, bc.local_cover_path, bc.ranked_status, bc.difficulties_json, bc.last_updated]);
    }

    // Insert users_cache
    for (const uc of backup.users_cache || []) {
      await db.run(`
        INSERT INTO users_cache (id, username, avatar_url, country_code, last_updated)
        VALUES (?, ?, ?, ?, ?)
      `, [uc.id, uc.username, uc.avatar_url, uc.country_code, uc.last_updated]);
    }

    // Insert history
    for (const h of backup.history || []) {
      await db.run(`
        INSERT INTO history (id, request_id, action_type, details, created_at)
        VALUES (?, ?, ?, ?, ?)
      `, [h.id, h.request_id, h.action_type, h.details, h.created_at]);
    }

    // Insert tags
    for (const t of backup.tags || []) {
      await db.run('INSERT INTO tags (id, name) VALUES (?, ?)', [t.id, t.name]);
    }

    // Insert request_tags
    for (const rt of backup.request_tags || []) {
      await db.run('INSERT INTO request_tags (request_id, tag_id) VALUES (?, ?)', [rt.request_id, rt.tag_id]);
    }

    // Insert settings
    for (const s of backup.settings || []) {
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [s.key, s.value]);
    }

    await db.run('PRAGMA foreign_keys = ON');

    res.json({ success: true, message: 'Backup JSON restored successfully' });
  } catch (error) {
    // Re-enable foreign keys just in case
    const db = await getDatabase();
    await db.run('PRAGMA foreign_keys = ON');
    next(error);
  }
});

// POST /api/migration/import-beatmap-links - Import one osu! beatmap link per line.
router.post('/import-beatmap-links', async (req, res, next) => {
  try {
    const { linksText, categories } = req.body;
    if (typeof linksText !== 'string' || !linksText.trim()) {
      return res.status(400).json({ error: 'linksText is required in request body' });
    }

    const importCategories = Array.isArray(categories)
      ? [...new Set(categories.filter(category => IMPORT_CATEGORY_NAMES.has(category)))]
      : ['Hitsounds'];
    if (importCategories.length === 0) {
      return res.status(400).json({ error: 'Select at least one valid request category.' });
    }

    const lines = linksText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      return res.status(400).json({ error: 'Provide at least one osu! beatmap link.' });
    }

    const beatmapLinkPattern = /^https?:\/\/(?:www\.)?osu\.ppy\.sh\/(?:beatmapsets|beatmaps|b)\/\d+(?:[/?#].*)?$/i;
    const invalidLines = lines
      .map((link, index) => ({ link, line: index + 1 }))
      .filter(({ link }) => !beatmapLinkPattern.test(link) || !parseOsuLink(link));
    if (invalidLines.length > 0) {
      return res.status(400).json({
        error: `Only osu! beatmap links are supported. Invalid line${invalidLines.length === 1 ? '' : 's'}: ${invalidLines.map(({ line }) => line).join(', ')}`
      });
    }

    const db = await getDatabase();
    let importCount = 0;
    const apiJobId = createApiJob('Importing beatmap links');
    const prefetches = [];

    for (let i = 0; i < lines.length; i++) {
      const link = lines[i];
      const parsedLink = parseOsuLink(link);
      let beatmapsetId = null;
      if (parsedLink.type === 'beatmapset') {
        beatmapsetId = parsedLink.id;
      } else {
        addApiJobWork(apiJobId, 1);
        updateApiJob(apiJobId, 1);
        const mapData = await fetchBeatmap(parsedLink.id);
        if (mapData && mapData.beatmapset_id) {
          beatmapsetId = mapData.beatmapset_id;
        } else {
          continue;
        }
      }

      // Check if beatmapset ID is already added
      if (beatmapsetId) {
        const existing = await db.get('SELECT id FROM requests WHERE beatmapset_id = ?', beatmapsetId);
        if (existing) {
          continue;
        }

        // Pre-fetch beatmap metadata in the background (does not block the HTTP response)
        addApiJobWork(apiJobId, 2);
        prefetches.push(
          refreshAndCacheBeatmapset(db, beatmapsetId, apiJobId)
            .catch(err => {
              console.error(`Failed to pre-fetch metadata for ID ${beatmapsetId} during import:`, err.message);
            })
        );
      }

      // Insert request
      const result = await db.run(`
        INSERT INTO requests (
          beatmapset_id, is_osu_link, non_osu_artist, non_osu_title, non_osu_creator, non_osu_difficulty,
          requester_username, request_status, priority, deadline, notes, added_date, completed_date
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      `, [
        beatmapsetId,
        1,
        null,
        null,
        null,
        null,
        'Anonymous',
        'Accepted',
        'Low',
        null,
        null,
        null
      ]);

      const requestId = result.lastID;

      for (const categoryName of importCategories) {
        await db.run(`
          INSERT INTO request_categories (request_id, category_name, other_text, status)
          VALUES (?, ?, ?, ?)
        `, [requestId, categoryName, null, 'Pending']);
      }

      // Create history
      await db.run(`
        INSERT INTO history (request_id, action_type, details)
        VALUES (?, ?, ?)
      `, [requestId, 'created', 'Request imported from beatmap link list']);

      importCount++;
    }

    // Do not return until all imported beatmaps have finished their metadata sync.
    // The frontend refreshes the request table after this response, so the cache
    // must be populated before the response is sent.
    await Promise.allSettled(prefetches);
    finishApiJob(apiJobId);

    res.json({
      success: true,
      message: `Beatmap links imported successfully. Imported ${importCount} requests.`
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
