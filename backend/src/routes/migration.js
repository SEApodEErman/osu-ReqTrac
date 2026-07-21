const express = require('express');
const multer = require('multer');
const router = express.Router();
const { getDatabase, coversDir, BUILTIN_CATEGORIES } = require('../db');
const { fetchBeatmaps } = require('../osuApi');
const { createApiJob, addApiJobWork, updateApiJob, finishApiJob } = require('../osuApi');
const { parseOsuLink } = require('../utils/requestUtils');
const { parseWorkbook, suggestMapping, validateMapping, normalizeRows } = require('../utils/spreadsheetImport');
const { initializeMetadataSyncWorker, pauseMetadataSyncWorker, queueBeatmapMetadata } = require('../services/beatmapMetadataSync');
const { BACKUP_VERSION, readCoverFiles, validateBackup, writeCoverFiles } = require('../utils/backup');
const { acquireBackupLock } = require('../utils/backupLock');
const { waitForBackgroundTasks } = require('../utils/backgroundTasks');

const spreadsheetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function readJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function spreadsheetBuffer(req) {
  if (req.file) return req.file.buffer;

  const sourceUrl = String(req.body.sourceUrl || '').trim();
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error('Upload a CSV or Excel file, or provide a valid public Google Sheets URL.');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') {
    throw new Error('Only public https://docs.google.com/spreadsheets URLs are supported.');
  }
  const match = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  if (!match) throw new Error('Provide a Google Sheets spreadsheet URL.');

  const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${match[1]}/export`);
  exportUrl.searchParams.set('format', 'xlsx');
  const gid = url.searchParams.get('gid');
  if (gid) exportUrl.searchParams.set('gid', gid);
  const response = await fetch(exportUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Could not download the Google Sheet. Ensure that it is publicly accessible.');
  return Buffer.from(await response.arrayBuffer());
}

function spreadsheetForName(worksheets, name) {
  const worksheet = worksheets.find(sheet => sheet.name === name) || worksheets[0];
  if (!worksheet.headers.some(header => header && !header.startsWith('Column '))) {
    throw new Error('The selected worksheet must include a header row.');
  }
  return worksheet;
}

function importableCategories(values, categoryNames) {
  const byName = new Map(categoryNames.map(name => [name.toLowerCase(), name]));
  const categories = Array.isArray(values)
    ? values.map(value => byName.get(String(value).toLowerCase())).filter(Boolean)
    : [];
  return categories.length > 0 ? [...new Set(categories)] : [byName.get('hitsounds') || categoryNames[0]];
}

// GET /api/migration/export - Export backup JSON
router.get('/export', async (req, res, next) => {
  let transactionStarted = false;
  let releaseBackupLock;
  try {
    releaseBackupLock = await acquireBackupLock();
    await waitForBackgroundTasks();
    const db = await getDatabase();
    await pauseMetadataSyncWorker();
    await db.exec('BEGIN');
    transactionStarted = true;
    const requests = await db.all('SELECT * FROM requests');
    const categories = await db.all('SELECT * FROM categories');
    const request_categories = await db.all('SELECT * FROM request_categories');
    const request_guest_difficulties = await db.all('SELECT * FROM request_guest_difficulties');
    const beatmap_cache = await db.all('SELECT * FROM beatmap_cache');
    const users_cache = await db.all('SELECT * FROM users_cache');
    const user_username_history = await db.all('SELECT * FROM user_username_history');
    const unavailable_osu_users = await db.all('SELECT * FROM unavailable_osu_users');
    const beatmap_metadata_sync = await db.all('SELECT * FROM beatmap_metadata_sync');
    const history = await db.all('SELECT * FROM history');
    const tags = await db.all('SELECT * FROM tags');
    const request_tags = await db.all('SELECT * FROM request_tags');
    const settings = await db.all('SELECT * FROM settings');
    const sqlite_sequence = await db.all('SELECT name, seq FROM sqlite_sequence');
    const cover_files = await readCoverFiles(coversDir);

    const backup = {
      version: BACKUP_VERSION,
      exported_at: new Date().toISOString(),
      requests,
      categories,
      request_categories,
      request_guest_difficulties,
      beatmap_cache,
      users_cache,
      user_username_history,
      unavailable_osu_users,
      beatmap_metadata_sync,
      history,
      tags,
      request_tags,
      settings,
      sqlite_sequence,
      cover_files
    };

    await db.exec('COMMIT');
    transactionStarted = false;
    await initializeMetadataSyncWorker();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=backup.json');
    res.json(backup);
  } catch (error) {
    if (transactionStarted) {
      const db = await getDatabase();
      await db.exec('ROLLBACK');
      await initializeMetadataSyncWorker();
    }
    next(error);
  } finally {
    releaseBackupLock?.();
  }
});

// POST /api/migration/import-json - Restore backup JSON
router.post('/import-json', async (req, res, next) => {
  let db;
  let transactionStarted = false;
  let releaseBackupLock;
  let originalCoverFiles;
  let coverFilesModified = false;
  try {
    let backup;
    try {
      backup = validateBackup(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    releaseBackupLock = await acquireBackupLock();
    await waitForBackgroundTasks();
    db = await getDatabase();
    await pauseMetadataSyncWorker();

    await db.exec('BEGIN TRANSACTION');
    transactionStarted = true;

    // Clear existing tables
    await db.run('DELETE FROM request_categories');
    await db.run('DELETE FROM request_guest_difficulties');
    await db.run('DELETE FROM request_tags');
    await db.run('DELETE FROM history');
    await db.run('DELETE FROM requests');
    await db.run('DELETE FROM beatmap_cache');
    await db.run('DELETE FROM beatmap_metadata_sync');
    await db.run('DELETE FROM user_username_history');
    await db.run('DELETE FROM unavailable_osu_users');
    await db.run('DELETE FROM users_cache');
    await db.run('DELETE FROM tags');
    await db.run('DELETE FROM settings');

    if (backup.version === BACKUP_VERSION) {
      await db.run('DELETE FROM categories');
      for (const category of backup.categories) {
        await db.run(`
          INSERT INTO categories (id, name, system_key, view_type, sort_order, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, category.id, category.name, category.system_key, category.view_type, category.sort_order,
        category.is_active, category.created_at, category.updated_at);
      }
    } else {
      await db.run('DELETE FROM categories WHERE system_key IS NULL');
      for (const [name, systemKey, viewType, sortOrder] of BUILTIN_CATEGORIES) {
        await db.run(`
          UPDATE categories SET name = ?, view_type = ?, sort_order = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP
          WHERE system_key = ?
        `, name, viewType, sortOrder, systemKey);
      }
      for (const categoryName of new Set((backup.request_categories || []).map(row => row.category_name).filter(Boolean))) {
        await db.run(`
          INSERT OR IGNORE INTO categories (name, view_type, sort_order, is_active)
          VALUES (?, 'tagged', (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories), 1)
        `, categoryName);
      }
    }

    // Insert requests
    for (const r of backup.requests || []) {
      await db.run(`
        INSERT INTO requests (id, beatmapset_id, is_osu_link, non_osu_artist, non_osu_title, non_osu_creator, non_osu_difficulty, requester_id, requester_username, request_status, priority, deadline, notes, input_link, discord_link, osu_profile_link, added_date, completed_date, last_updated, guest_difficulty_target_sr, guest_difficulty_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [r.id, r.beatmapset_id, r.is_osu_link, r.non_osu_artist, r.non_osu_title, r.non_osu_creator, r.non_osu_difficulty, r.requester_id, r.requester_username, r.request_status, r.priority, r.deadline, r.notes, r.input_link ?? null, r.discord_link, r.osu_profile_link, r.added_date, r.completed_date, r.last_updated, r.guest_difficulty_target_sr ?? null, r.guest_difficulty_name ?? null]);
    }

    // Insert request_categories
    for (const rc of backup.request_categories || []) {
      const category = rc.category_id
        ? await db.get('SELECT id, name FROM categories WHERE id = ?', rc.category_id)
        : await db.get('SELECT id, name FROM categories WHERE name = ? COLLATE NOCASE', rc.category_name);
      if (!category) throw new Error(`Backup references an unknown category: ${rc.category_name || rc.category_id}`);
      await db.run(`
        INSERT INTO request_categories (id, request_id, category_id, category_name, other_text, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [rc.id, rc.request_id, category.id, category.name, rc.other_text, rc.status]);
    }

    if (backup.version === BACKUP_VERSION) {
      for (const gd of backup.request_guest_difficulties) {
        await db.run(`
          INSERT INTO request_guest_difficulties (
            id, request_id, beatmap_id, difficulty_name, gamemode, target_sr, sort_order, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, gd.id, gd.request_id, gd.beatmap_id, gd.difficulty_name, gd.gamemode || 'osu', gd.target_sr,
        gd.sort_order || 0, gd.created_at, gd.updated_at);
      }
    } else {
      await db.run(`
        INSERT INTO request_guest_difficulties (request_id, difficulty_name, gamemode, target_sr, sort_order)
        SELECT id, guest_difficulty_name, 'osu', guest_difficulty_target_sr, 0
        FROM requests
        WHERE guest_difficulty_name IS NOT NULL OR guest_difficulty_target_sr IS NOT NULL
      `);
    }

    // Insert beatmap_cache
    for (const bc of backup.beatmap_cache || []) {
      await db.run(`
        INSERT INTO beatmap_cache (beatmapset_id, artist, title, creator, creator_id, cover_url, local_cover_path, ranked_status, difficulties_json, ranked_date, osu_last_updated, submitted_date, metadata_complete, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [bc.beatmapset_id, bc.artist, bc.title, bc.creator, bc.creator_id, bc.cover_url, bc.local_cover_path, bc.ranked_status, bc.difficulties_json, bc.ranked_date ?? null, bc.osu_last_updated ?? null, bc.submitted_date ?? null, bc.metadata_complete ?? (backup.version === '1.0.0' ? 0 : 1), bc.last_updated]);
    }

    for (const sync of backup.beatmap_metadata_sync || []) {
      await db.run(`
        INSERT INTO beatmap_metadata_sync (beatmapset_id, status, attempt_count, last_error, next_attempt_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [sync.beatmapset_id, sync.status, sync.attempt_count, sync.last_error, sync.next_attempt_at, sync.created_at, sync.updated_at]);
    }

    // Insert users_cache
    for (const uc of backup.users_cache || []) {
      await db.run(`
        INSERT INTO users_cache (id, username, avatar_url, country_code, last_updated)
        VALUES (?, ?, ?, ?, ?)
      `, [uc.id, uc.username, uc.avatar_url, uc.country_code, uc.last_updated]);
    }

    for (const identity of backup.user_username_history || []) {
      await db.run(`
        INSERT OR IGNORE INTO user_username_history (user_id, username, first_seen, last_seen)
        VALUES (?, ?, ?, ?)
      `, [identity.user_id, identity.username, identity.first_seen, identity.last_seen]);
    }

    for (const unavailableUser of backup.unavailable_osu_users || []) {
      await db.run(`
        INSERT OR IGNORE INTO unavailable_osu_users (user_id, username, first_failed_at)
        VALUES (?, ?, ?)
      `, [unavailableUser.user_id, unavailableUser.username, unavailableUser.first_failed_at]);
    }

    // Insert history
    for (const h of backup.history || []) {
      await db.run(`
        INSERT INTO history (id, request_id, action_type, details, created_at)
        VALUES (?, ?, ?, ?, ?)
      `, [h.id, h.request_id, h.action_type, h.details, h.created_at]);
    }

    // Insert tags
    const restoredTagIds = new Map();
    for (const t of backup.tags || []) {
      const existingTag = await db.get('SELECT id FROM tags WHERE name = ? COLLATE NOCASE', t.name);
      if (existingTag) {
        restoredTagIds.set(t.id, existingTag.id);
      } else {
        await db.run('INSERT INTO tags (id, name) VALUES (?, ?)', [t.id, t.name]);
        restoredTagIds.set(t.id, t.id);
      }
    }

    // Insert request_tags
    for (const rt of backup.request_tags || []) {
      await db.run('INSERT OR IGNORE INTO request_tags (request_id, tag_id) VALUES (?, ?)', [rt.request_id, restoredTagIds.get(rt.tag_id) || rt.tag_id]);
    }

    // Insert settings
    for (const s of backup.settings || []) {
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [s.key, s.value]);
    }

    await db.run('DELETE FROM sqlite_sequence');
    for (const sequence of backup.sqlite_sequence) {
      await db.run('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)', sequence.name, sequence.seq);
    }

    const foreignKeyErrors = await db.all('PRAGMA foreign_key_check');
    if (foreignKeyErrors.length > 0) {
      throw new Error(`Backup restore failed integrity validation (${foreignKeyErrors.length} foreign-key errors).`);
    }

    if (backup._hasCoverFiles) {
      originalCoverFiles = await readCoverFiles(coversDir);
      coverFilesModified = true;
      await writeCoverFiles(coversDir, backup.cover_files);
    }

    await db.exec('COMMIT');
    transactionStarted = false;
    await db.run('PRAGMA foreign_keys = ON');
    await initializeMetadataSyncWorker();

    res.json({ success: true, message: 'Backup JSON restored successfully' });
  } catch (error) {
    // Re-enable foreign keys just in case
    db ||= await getDatabase();
    if (transactionStarted) await db.exec('ROLLBACK');
    if (coverFilesModified && originalCoverFiles) {
      await writeCoverFiles(coversDir, originalCoverFiles).catch(restoreError => {
        console.error('[migration] Failed to restore original cover files:', restoreError.message);
      });
    }
    await db.run('PRAGMA foreign_keys = ON');
    await initializeMetadataSyncWorker();
    next(error);
  } finally {
    releaseBackupLock?.();
  }
});

// POST /api/migration/import-beatmap-links - Import one osu! beatmap link per line.
router.post('/import-beatmap-links', async (req, res, next) => {
  let apiJobId = null;
  let db;
  let transactionStarted = false;
  try {
    const { linksText, categories } = req.body;
    if (typeof linksText !== 'string' || !linksText.trim()) {
      return res.status(400).json({ error: 'linksText is required in request body' });
    }

    db = await getDatabase();
    const categoryCatalog = await db.all('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, id');
    const importCategoryNames = importableCategories(categories, categoryCatalog.map(category => category.name));
    const categoryByName = new Map(categoryCatalog.map(category => [category.name, category]));
    const importCategories = importCategoryNames.map(name => categoryByName.get(name)).filter(Boolean);
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

    await db.exec('BEGIN TRANSACTION');
    transactionStarted = true;
    let importCount = 0;
    let metadataQueued = 0;
    let metadataAlreadyAvailable = 0;
    let metadataFailed = 0;
    let missingBeatmaps = 0;
    apiJobId = createApiJob('Importing beatmap links');
    const parsedLinks = lines.map(parseOsuLink);
    const beatmapIds = parsedLinks
      .filter(parsedLink => parsedLink.type === 'beatmap')
      .map(parsedLink => parsedLink.id);
    const beatmapBatchCount = Math.ceil(new Set(beatmapIds).size / 50);
    const failedBeatmapIds = new Set();
    const existingRequestRows = await db.all('SELECT id, beatmapset_id FROM requests WHERE beatmapset_id IS NOT NULL');
    const existingRequestByBeatmapset = new Map(
      existingRequestRows.map(existingRequest => [existingRequest.beatmapset_id, existingRequest])
    );

    addApiJobWork(apiJobId, beatmapBatchCount);
    const fetchedBeatmaps = await fetchBeatmaps(beatmapIds, {
      onBatchError: batch => batch.forEach(id => failedBeatmapIds.add(id))
    });
    updateApiJob(apiJobId, beatmapBatchCount);
    let fetchedBeatmapIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const parsedLink = parsedLinks[i];
      let beatmapsetId = null;
      let provisional = null;
      if (parsedLink.type === 'beatmapset') {
        beatmapsetId = parsedLink.id;
      } else {
        const mapData = fetchedBeatmaps[fetchedBeatmapIndex++];
        if (mapData && mapData.beatmapset_id) {
          beatmapsetId = mapData.beatmapset_id;
          provisional = mapData.beatmapset;
        } else {
          if (!failedBeatmapIds.has(parsedLink.id)) missingBeatmaps++;
          continue;
        }
      }

      // Check if beatmapset ID is already added
      if (beatmapsetId) {
        const existing = existingRequestByBeatmapset.get(beatmapsetId);
        if (existing) {
          continue;
        }

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

      for (const category of importCategories) {
        await db.run(`
          INSERT INTO request_categories (request_id, category_id, category_name, other_text, status)
          VALUES (?, ?, ?, ?, ?)
        `, [requestId, category.id, category.name, null, 'Pending']);
      }

      // Create history
      await db.run(`
        INSERT INTO history (request_id, action_type, details)
        VALUES (?, ?, ?)
      `, [requestId, 'created', 'Request imported from beatmap link list']);

      importCount++;
      existingRequestByBeatmapset.set(beatmapsetId, { id: requestId, beatmapset_id: beatmapsetId });
      const metadataState = await queueBeatmapMetadata(db, beatmapsetId, provisional);
      if (metadataState === 'available') metadataAlreadyAvailable++;
      else if (metadataState === 'failed') metadataFailed++;
      else metadataQueued++;
    }

    await db.exec('COMMIT');
    transactionStarted = false;
    void initializeMetadataSyncWorker().catch(error => console.error('[migration] Failed to start metadata worker:', error.message));
    finishApiJob(apiJobId);
    apiJobId = null;

    res.json({
      success: true,
      metadataQueued,
      metadataAlreadyAvailable,
      metadataFailed,
      missingBeatmaps,
      apiFailures: failedBeatmapIds.size,
      message: `Imported ${importCount} requests. ${metadataQueued} beatmapsets are syncing in the background.${metadataFailed ? ` ${metadataFailed} beatmapsets require a manual metadata retry.` : ''}${missingBeatmaps ? ` ${missingBeatmaps} beatmaps were not found.` : ''}${failedBeatmapIds.size ? ` ${failedBeatmapIds.size} beatmaps could not be resolved because an API batch failed.` : ''}`
    });
  } catch (error) {
    if (transactionStarted) await db.exec('ROLLBACK');
    if (apiJobId) finishApiJob(apiJobId);
    next(error);
  }
});

// POST /api/migration/import-spreadsheet - Preview or import CSV, Excel, and public Google Sheets data.
router.post('/import-spreadsheet', spreadsheetUpload.single('file'), async (req, res, next) => {
  let apiJobId = null;
  let db;
  let transactionStarted = false;
  try {
    const action = req.body.action || 'inspect';
    const worksheets = parseWorkbook(await spreadsheetBuffer(req));
    const worksheet = spreadsheetForName(worksheets, req.body.worksheet);

    if (action === 'inspect') {
      return res.json({
        worksheets: worksheets.map(sheet => sheet.name),
        worksheet: worksheet.name,
        headers: worksheet.headers,
        suggestedMapping: suggestMapping(worksheet.headers),
        sampleRows: worksheet.rows.slice(0, 5)
      });
    }

    const suppliedMapping = readJson(req.body.mapping, {});
    const mappingResult = validateMapping(worksheet.headers, suppliedMapping);
    if (mappingResult.errors.length > 0) {
      return res.status(400).json({ error: mappingResult.errors.join(' ') });
    }

    db = await getDatabase();
    const categoryCatalog = await db.all('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, id');
    const categoryNames = categoryCatalog.map(category => category.name);
    const categoryByName = new Map(categoryCatalog.map(category => [category.name, category]));
    const defaultCategories = importableCategories(readJson(req.body.defaultCategories, ['Hitsounds']), categoryNames);
    const { records, errors } = normalizeRows(
      worksheet.headers, worksheet.rows, mappingResult.mapping, defaultCategories, new Set(categoryNames)
    );
    if (errors.length > 0) return res.status(400).json({ error: errors.join(' ') });

    const invalidRecords = records.filter(record => record.errors.length > 0);
    if (action === 'preview') {
      return res.json({
        worksheet: worksheet.name,
        totalRows: records.length,
        validRows: records.length - invalidRecords.length,
        invalidRows: invalidRecords.map(record => ({ rowNumber: record.rowNumber, errors: record.errors })),
        previewRows: records.slice(0, 20).map(record => ({
          rowNumber: record.rowNumber,
          link: record.link || '',
          title: record.title || '',
          notes: record.notes || '',
          errors: record.errors
        }))
      });
    }

    if (action !== 'import') return res.status(400).json({ error: 'Invalid spreadsheet import action.' });

    const duplicateMode = req.body.duplicateMode === 'update' ? 'update' : 'skip';
    const validRecords = records.filter(record => record.errors.length === 0);
    const parsedLinks = validRecords.map(record => record.link ? parseOsuLink(record.link) : null);
    const beatmapIds = parsedLinks
      .filter(parsedLink => parsedLink?.type === 'beatmap')
      .map(parsedLink => parsedLink.id);
    apiJobId = createApiJob('Importing spreadsheet');
    const beatmapBatchCount = Math.ceil(new Set(beatmapIds).size / 50);
    const failedBeatmapIds = new Set();
    addApiJobWork(apiJobId, beatmapBatchCount);
    const fetchedBeatmaps = await fetchBeatmaps(beatmapIds, {
      onBatchError: batch => batch.forEach(id => failedBeatmapIds.add(id))
    });
    updateApiJob(apiJobId, beatmapBatchCount);
    let fetchedBeatmapIndex = 0;
    await db.exec('BEGIN TRANSACTION');
    transactionStarted = true;
    const result = {
      imported: 0,
      updated: 0,
      skippedDuplicates: 0,
      invalid: invalidRecords.length,
      missingBeatmaps: 0,
      apiFailures: 0,
      metadataQueued: 0,
      metadataAlreadyAvailable: 0,
      metadataFailed: 0,
      errors: invalidRecords.map(record => ({ rowNumber: record.rowNumber, error: record.errors.join(' ') }))
    };
    const existingRequestRows = await db.all('SELECT id, beatmapset_id FROM requests WHERE beatmapset_id IS NOT NULL');
    const existingRequestByBeatmapset = new Map(
      existingRequestRows.map(existingRequest => [existingRequest.beatmapset_id, existingRequest])
    );

    for (let index = 0; index < validRecords.length; index++) {
      const record = validRecords[index];
      const parsedLink = parsedLinks[index];
      let beatmapsetId = null;
      let isOsuLink = false;
      let provisional = null;

      if (record.link) {
        if (!parsedLink) {
          result.invalid++;
          result.errors.push({ rowNumber: record.rowNumber, error: 'Invalid osu! beatmap link.' });
          continue;
        }
        isOsuLink = true;
        if (parsedLink.type === 'beatmapset') {
          beatmapsetId = parsedLink.id;
        } else {
          const beatmap = fetchedBeatmaps[fetchedBeatmapIndex++];
          beatmapsetId = beatmap?.beatmapset_id || null;
          provisional = beatmap?.beatmapset || null;
        }
        if (!beatmapsetId) {
          if (parsedLink.type === 'beatmap' && failedBeatmapIds.has(parsedLink.id)) {
            result.apiFailures++;
            result.errors.push({ rowNumber: record.rowNumber, error: 'Beatmap lookup failed because the osu! API batch failed.' });
          } else {
            result.missingBeatmaps++;
            result.errors.push({ rowNumber: record.rowNumber, error: 'Beatmap was not found on osu!.' });
          }
          continue;
        }
        if (!provisional) {
          provisional = {
            id: beatmapsetId,
            artist: record.artist,
            title: record.title,
            creator: record.creator
          };
        }
      }

      const existing = beatmapsetId ? existingRequestByBeatmapset.get(beatmapsetId) : null;
      if (existing && duplicateMode === 'skip') {
        result.skippedDuplicates++;
        continue;
      }

      if (existing) {
        await db.run(`
          UPDATE requests SET requester_username = ?, request_status = ?, priority = ?, deadline = ?, notes = ?,
            discord_link = ?, osu_profile_link = ?, added_date = COALESCE(?, added_date),
            completed_date = COALESCE(?, completed_date), last_updated = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          record.requester || 'Anonymous', record.status, record.priority, record.deadline || null, record.notes || null,
          record.discordLink || null, record.osuProfileLink || null, record.addedDate || null, record.completedDate || null, existing.id
        ]);
        for (const category of record.categories) {
          const categoryDefinition = categoryByName.get(category);
          await db.run(`
            INSERT INTO request_categories (request_id, category_id, category_name, other_text, status)
            SELECT ?, ?, ?, NULL, 'Pending'
            WHERE NOT EXISTS (
              SELECT 1 FROM request_categories WHERE request_id = ? AND category_id = ?
            )
          `, existing.id, categoryDefinition.id, categoryDefinition.name, existing.id, categoryDefinition.id);
        }
        result.updated++;
        const metadataState = await queueBeatmapMetadata(db, beatmapsetId, provisional);
        if (metadataState === 'available') result.metadataAlreadyAvailable++;
        else if (metadataState === 'failed') result.metadataFailed++;
        else result.metadataQueued++;
        continue;
      }

      const insertResult = await db.run(`
        INSERT INTO requests (
          beatmapset_id, is_osu_link, non_osu_artist, non_osu_title, non_osu_creator, non_osu_difficulty,
          requester_username, request_status, priority, deadline, notes, input_link, discord_link, osu_profile_link,
          added_date, completed_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        beatmapsetId,
        isOsuLink ? 1 : 0,
        isOsuLink ? null : (record.artist || null),
        isOsuLink ? null : (record.title || null),
        isOsuLink ? null : (record.creator || null),
        isOsuLink ? null : (record.difficulty || null),
        record.requester || 'Anonymous', record.status, record.priority, record.deadline || null, record.notes || null,
        record.link || null, record.discordLink || null, record.osuProfileLink || null,
        record.addedDate || null, record.completedDate || null
      ]);

      for (const category of record.categories) {
        const categoryDefinition = categoryByName.get(category);
        await db.run(
          'INSERT INTO request_categories (request_id, category_id, category_name, other_text, status) VALUES (?, ?, ?, ?, ?)',
          [insertResult.lastID, categoryDefinition.id, categoryDefinition.name, null, 'Pending']
        );
      }
      await db.run('INSERT INTO history (request_id, action_type, details) VALUES (?, ?, ?)', [
        insertResult.lastID, 'created', `Request imported from spreadsheet row ${record.rowNumber}`
      ]);
      result.imported++;
      if (beatmapsetId) {
        existingRequestByBeatmapset.set(beatmapsetId, { id: insertResult.lastID, beatmapset_id: beatmapsetId });
      }

      if (beatmapsetId) {
        const metadataState = await queueBeatmapMetadata(db, beatmapsetId, provisional);
        if (metadataState === 'available') result.metadataAlreadyAvailable++;
        else if (metadataState === 'failed') result.metadataFailed++;
        else result.metadataQueued++;
      }
    }

    await db.exec('COMMIT');
    transactionStarted = false;
    void initializeMetadataSyncWorker().catch(error => console.error('[migration] Failed to start metadata worker:', error.message));
    finishApiJob(apiJobId);
    apiJobId = null;
    res.json({ success: true, ...result });
  } catch (error) {
    if (transactionStarted) await db.exec('ROLLBACK');
    if (apiJobId) finishApiJob(apiJobId);
    next(error);
  }
});

module.exports = router;
