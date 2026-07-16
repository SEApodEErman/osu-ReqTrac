const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db');
const { refreshAndCacheBeatmapset } = require('./beatmaps');
const { fetchBeatmap, fetchUser, downloadCover } = require('../osuApi');
const { createApiJob, addApiJobWork, updateApiJob, finishApiJob } = require('../osuApi');

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
// Expected columns: Artist, Title, Mapper, Link, Map Status, Remarks
router.post('/import-csv', async (req, res, next) => {
  try {
    const { csvText } = req.body;
    if (!csvText) {
      return res.status(400).json({ error: 'csvText is required in request body' });
    }

    // Accept either the legacy CSV format or a simple one-link-per-line list.
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) {
      return res.status(400).json({ error: 'Provide at least one beatmap link or a CSV data row.' });
    }

    const linkListMode = lines.every(line => /^https?:\/\/(?:www\.)?osu\.ppy\.sh\/(?:beatmapsets|beatmaps|b)\/\d+/i.test(line.trim()));
    const headers = linkListMode ? [] : parseCSVLine(lines[0]);
    
    // Map columns by header name (case-insensitive, ignores extra whitespace)
    const headerMap = {};
    headers.forEach((h, idx) => {
      const normalized = h.trim().toLowerCase();
      headerMap[normalized] = idx;
    });

    // Required column mappings
    const getColIndex = (names) => {
      for (const name of names) {
        const idx = headerMap[name.toLowerCase()];
        if (idx !== undefined) return idx;
      }
      return -1;
    };

    const colIndices = {
      artist: getColIndex(['artist']),
      title: getColIndex(['title']),
      mapper: getColIndex(['mapper', 'creator']),
      link: getColIndex(['link', 'url', 'beatmapset', 'beatmap']),
      mapStatus: getColIndex(['map status', 'mapstatus', 'status']),
      remarks: getColIndex(['remarks', 'notes', 'comments'])
    };

    // Validate required columns
    const missingColumns = [];
    if (!linkListMode && colIndices.artist === -1) missingColumns.push('Artist');
    if (!linkListMode && colIndices.title === -1) missingColumns.push('Title');
    if (!linkListMode && colIndices.mapper === -1) missingColumns.push('Mapper');
    if (!linkListMode && colIndices.link === -1) missingColumns.push('Link');
    if (!linkListMode && colIndices.mapStatus === -1) missingColumns.push('Map Status');
    if (!linkListMode && colIndices.remarks === -1) missingColumns.push('Remarks');

    if (missingColumns.length > 0) {
      return res.status(400).json({ 
        error: `Missing required columns: ${missingColumns.join(', ')}. Expected columns: Artist, Title, Mapper, Link, Map Status, Remarks`,
        expectedColumns: ['Artist', 'Title', 'Mapper', 'Link', 'Map Status', 'Remarks'],
        foundHeaders: headers
      });
    }

    const db = await getDatabase();
    let importCount = 0;
    const errors = [];
    const apiJobId = createApiJob(linkListMode ? 'Importing beatmap links' : 'Importing CSV metadata');
    const prefetches = [];

    for (let i = linkListMode ? 0 : 1; i < lines.length; i++) {
      const row = parseCSVLine(lines[i]);
      if (row.length === 0 || (row.length === 1 && !row[0])) continue;

      // Extract values using column indices
      const rawArtist = linkListMode ? '' : (row[colIndices.artist] || '');
      const rawTitle = linkListMode ? '' : (row[colIndices.title] || '');
      const rawMapper = linkListMode ? '' : (row[colIndices.mapper] || '');
      const rawLink = linkListMode ? lines[i] : (row[colIndices.link] || '');
      const rawMapStatus = linkListMode ? '' : (row[colIndices.mapStatus] || '');
      const rawRemarks = linkListMode ? '' : (row[colIndices.remarks] || '');

      // Trim whitespace
      const artist = rawArtist.trim();
      const title = rawTitle.trim();
      const mapper = rawMapper.trim();
      const link = rawLink.trim();
      const mapStatus = rawMapStatus.trim();
      const remarks = rawRemarks.trim();

      // Validate required fields
      if ((!linkListMode && (!artist || !title || !mapper)) || !link) {
        errors.push(`Row ${i + 1}: Missing required fields (Artist, Title, Mapper, Link)`);
        continue;
      }

      // Parse link to detect osu! beatmap link
      let beatmapsetId = null;
      let isOsuLink = false;
      const setRegex = /osu\.ppy\.sh\/beatmapsets\/(\d+)/i;
      const setMatch = link.match(setRegex);
      if (setMatch) {
        beatmapsetId = parseInt(setMatch[1], 10);
        isOsuLink = true;
      } else {
        const mapRegex = /osu\.ppy\.sh\/(?:beatmaps|b)\/(\d+)/i;
        const mapMatch = link.match(mapRegex);
        if (mapMatch) {
          // It's a beatmap link, fetch to get beatmapset_id
          isOsuLink = true;
          addApiJobWork(apiJobId, 1);
          updateApiJob(apiJobId, 1);
          try {
            const mapData = await fetchBeatmap(parseInt(mapMatch[1], 10));
            if (mapData && mapData.beatmapset_id) {
              beatmapsetId = mapData.beatmapset_id;
            }
          } catch (e) {
            console.error(`Failed to fetch beatmapset for beatmap ${mapMatch[1]}:`, e.message);
          }
        }
      }

      // Map status to enum
      let status = 'Accepted';
      const normStatus = mapStatus.toLowerCase();
      if (normStatus.includes('work') || normStatus.includes('prog') || normStatus.includes('wip')) {
        status = 'Working';
      } else if (normStatus.includes('comp') || normStatus.includes('done') || normStatus.includes('complete')) {
        status = 'Completed';
      } else if (normStatus.includes('canc') || normStatus.includes('drop') || normStatus.includes('reject')) {
        status = 'Cancelled';
      }

      // Check if beatmapset ID is already added
      if (beatmapsetId) {
        const existing = await db.get('SELECT id FROM requests WHERE beatmapset_id = ?', beatmapsetId);
        if (existing) {
          // Skip duplicates during bulk CSV import
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
        isOsuLink ? 1 : 0,
        isOsuLink ? null : artist,
        isOsuLink ? null : title,
        isOsuLink ? null : mapper,
        null, // difficulty not in new format
        'Anonymous', // requester - will be auto-populated from osu! API for osu links
        status,
        'Medium', // default priority
        null, // deadline not in new format
        remarks || null,
        status === 'Completed' ? new Date().toISOString() : null
      ]);

      const requestId = result.lastID;

      // Default category: Hitsounds
      await db.run(`
        INSERT INTO request_categories (request_id, category_name, other_text, status)
        VALUES (?, ?, ?, ?)
      `, [requestId, 'Hitsounds', null, status === 'Completed' ? 'Completed' : 'Pending']);

      // Create history
      await db.run(`
        INSERT INTO history (request_id, action_type, details)
        VALUES (?, ?, ?)
      `, [requestId, 'created', linkListMode ? 'Request imported from beatmap link list' : 'Request imported via CSV']);

      importCount++;
    }

    Promise.allSettled(prefetches).then(() => finishApiJob(apiJobId));

    res.json({
      success: true,
      message: `${linkListMode ? 'Beatmap links' : 'CSV'} imported successfully. Imported ${importCount} requests.${errors.length > 0 ? ` ${errors.length} rows had errors.` : ''}`,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
