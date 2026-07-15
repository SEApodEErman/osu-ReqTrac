const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db');
const { refreshAndCacheBeatmapset } = require('./beatmaps');
const { fetchUser, downloadCover } = require('../osuApi');

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
        INSERT INTO requests (id, beatmapset_id, is_osu_link, non_osu_artist, non_osu_title, non_osu_creator, non_osu_difficulty, requester_id, requester_username, request_status, priority, deadline, notes, discord_link, osu_profile_link, added_date, completed_date, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [r.id, r.beatmapset_id, r.is_osu_link, r.non_osu_artist, r.non_osu_title, r.non_osu_creator, r.non_osu_difficulty, r.requester_id, r.requester_username, r.request_status, r.priority, r.deadline, r.notes, r.discord_link, r.osu_profile_link, r.added_date, r.completed_date, r.last_updated]);
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

// Clean up double quotes and escape characters in CSV cells
function cleanCSVCell(val) {
  if (!val) return '';
  return val.replace(/^"|"$/g, '').replace(/""/g, '"').trim();
}

// Custom CSV Line Parser supporting quotes
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map(cleanCSVCell);
}

// POST /api/migration/import-csv - Parse and load Google Sheets CSV file content
router.post('/import-csv', async (req, res, next) => {
  try {
    const { csvText } = req.body;
    if (!csvText) {
      return res.status(400).json({ error: 'csvText is required in request body' });
    }

    // Split CSV by newline characters
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV must contain at least a header row and one data row' });
    }

    const headers = parseCSVLine(lines[0]);
    
    // Find index of standard columns
    const colIndices = {
      link: headers.findIndex(h => /link|url|beatmapset|beatmap/i.test(h)),
      artist: headers.findIndex(h => /artist|song/i.test(h)),
      title: headers.findIndex(h => /title|name/i.test(h)),
      creator: headers.findIndex(h => /creator|mapper|host/i.test(h)),
      difficulty: headers.findIndex(h => /diff/i.test(h)),
      requester: headers.findIndex(h => /requestor|requester|user/i.test(h)),
      status: headers.findIndex(h => /status|state/i.test(h)),
      priority: headers.findIndex(h => /priority|importance/i.test(h)),
      deadline: headers.findIndex(h => /deadline|date|due/i.test(h)),
      notes: headers.findIndex(h => /notes|desc|details|comment/i.test(h)),
      tags: headers.findIndex(h => /tags|tag/i.test(h)),
      categories: headers.findIndex(h => /categories|category|type/i.test(h))
    };

    const db = await getDatabase();
    let importCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVLine(lines[i]);
      if (row.length === 0 || (row.length === 1 && !row[0])) continue;

      // Extract values using indices
      const rawLink = colIndices.link !== -1 ? row[colIndices.link] : '';
      const rawArtist = colIndices.artist !== -1 ? row[colIndices.artist] : '';
      const rawTitle = colIndices.title !== -1 ? row[colIndices.title] : '';
      const rawCreator = colIndices.creator !== -1 ? row[colIndices.creator] : '';
      const rawDiff = colIndices.difficulty !== -1 ? row[colIndices.difficulty] : '';
      const rawRequester = colIndices.requester !== -1 ? row[colIndices.requester] : 'Anonymous';
      const rawStatus = colIndices.status !== -1 ? row[colIndices.status] : 'Accepted';
      const rawPriority = colIndices.priority !== -1 ? row[colIndices.priority] : 'Medium';
      const rawDeadline = colIndices.deadline !== -1 ? row[colIndices.deadline] : null;
      const rawNotes = colIndices.notes !== -1 ? row[colIndices.notes] : '';
      const rawTags = colIndices.tags !== -1 ? row[colIndices.tags] : '';
      const rawCategories = colIndices.categories !== -1 ? row[colIndices.categories] : 'Hitsounds';

      // Parse link
      let beatmapsetId = null;
      let isOsuLink = false;
      const setRegex = /osu\.ppy\.sh\/beatmapsets\/(\d+)/i;
      const setMatch = rawLink.match(setRegex);
      if (setMatch) {
        beatmapsetId = parseInt(setMatch[1], 10);
        isOsuLink = true;
      } else {
        const mapRegex = /osu\.ppy\.sh\/(?:beatmaps|b)\/(\d+)/i;
        const mapMatch = rawLink.match(mapRegex);
        if (mapMatch) {
          // It's a beatmap link, we can attempt to fetch it in the background or insert it and fetch later
          // For CSV migration, we'll try to retrieve the beatmapset_id
          isOsuLink = true;
        }
      }

      // Format status to correct enum
      let status = 'Accepted';
      const normStatus = rawStatus.toLowerCase();
      if (normStatus.includes('work') || normStatus.includes('prog')) status = 'Working';
      else if (normStatus.includes('comp') || normStatus.includes('done')) status = 'Completed';
      else if (normStatus.includes('canc') || normStatus.includes('drop')) status = 'Cancelled';

      // Format priority
      let priority = 'Medium';
      const normPriority = rawPriority.toLowerCase();
      if (normPriority.includes('low')) priority = 'Low';
      else if (normPriority.includes('high') || normPriority.includes('urg')) priority = 'High';

      // Format deadline
      let deadline = null;
      if (rawDeadline) {
        const d = new Date(rawDeadline);
        if (!isNaN(d.getTime())) {
          deadline = d.toISOString().split('T')[0];
        }
      }

      // Check if beatmapset ID is already added
      if (beatmapsetId) {
        const existing = await db.get('SELECT id FROM requests WHERE beatmapset_id = ?', beatmapsetId);
        if (existing) {
          // Skip duplicates during bulk CSV import
          continue;
        }

        // Pre-fetch beatmap in cache synchronously so the table is populated correctly
        try {
          await refreshAndCacheBeatmapset(db, beatmapsetId);
        } catch (err) {
          console.error(`Failed to pre-fetch metadata for ID ${beatmapsetId} during CSV import:`, err.message);
        }
      }

      // Insert request
      const result = await db.run(`
        INSERT INTO requests (
          beatmapset_id, is_osu_link, non_osu_artist, non_osu_title, non_osu_creator, non_osu_difficulty,
          requester_username, request_status, priority, deadline, notes, added_date, completed_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      `, [
        beatmapsetId,
        isOsuLink ? 1 : 0,
        isOsuLink ? null : rawArtist,
        isOsuLink ? null : rawTitle,
        isOsuLink ? null : rawCreator,
        isOsuLink ? null : rawDiff,
        rawRequester || 'Anonymous',
        status,
        priority,
        deadline,
        rawNotes || null,
        status === 'Completed' ? new Date().toISOString() : null
      ]);

      const requestId = result.lastID;

      // Parse and insert Categories
      // Support comma-separated categories in CSV e.g., "Hitsounds, Guest Difficulty"
      const catsList = rawCategories.split(/[,;|]/).map(c => c.trim()).filter(Boolean);
      const validCategories = ['Hitsounds', 'Guest Difficulties', 'Storyboards', 'Others'];
      
      if (catsList.length === 0) {
        catsList.push('Hitsounds');
      }

      for (const cat of catsList) {
        let catName = 'Others';
        let otherText = null;

        // Try to match standard categories
        const normCat = cat.toLowerCase();
        if (normCat.includes('sound') || normCat.includes('hit')) {
          catName = 'Hitsounds';
        } else if (normCat.includes('guest') || normCat.includes('diff') || normCat.includes('gd')) {
          catName = 'Guest Difficulties';
        } else if (normCat.includes('story') || normCat.includes('sb') || normCat.includes('board')) {
          catName = 'Storyboards';
        } else {
          catName = 'Others';
          otherText = cat;
        }

        await db.run(`
          INSERT INTO request_categories (request_id, category_name, other_text, status)
          VALUES (?, ?, ?, ?)
        `, [requestId, catName, otherText, status === 'Completed' ? 'Completed' : 'Pending']);
      }

      // Parse and insert Tags
      const tagsList = rawTags.split(/[,;|]/).map(t => t.trim()).filter(Boolean);
      for (const tag of tagsList) {
        await db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', tag);
        const tagRow = await db.get('SELECT id FROM tags WHERE name = ?', tag);
        if (tagRow) {
          await db.run('INSERT OR IGNORE INTO request_tags (request_id, tag_id) VALUES (?, ?)', requestId, tagRow.id);
        }
      }

      // Create history
      await db.run(`
        INSERT INTO history (request_id, action_type, details)
        VALUES (?, ?, ?)
      `, [requestId, 'created', 'Request imported via CSV']);

      importCount++;
    }

    res.json({
      success: true,
      message: `CSV imported successfully. Imported ${importCount} requests.`
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
