const { getDatabase } = require('../db');
const { refreshAndCacheBeatmapset } = require('../routes/beatmaps');

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [30000, 120000];
let workerRunning = false;
let wakeTimer = null;
let workerPromise = null;
let pauseRequested = false;

function sqliteTimestamp(date) {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function provisionalCache(provisional, beatmapsetId) {
  if (!provisional) return null;
  return {
    beatmapsetId,
    artist: provisional.artist || '',
    title: provisional.title || '',
    creator: provisional.creator || '',
    creatorId: provisional.user_id || 0,
    coverUrl: provisional.covers?.cover || provisional.cover_url || '',
    rankedStatus: provisional.status
      ? provisional.status.charAt(0).toUpperCase() + provisional.status.slice(1).toLowerCase()
      : 'Pending'
  };
}

async function seedProvisionalCache(db, beatmapsetId, provisional, existingCache = undefined) {
  const cache = provisionalCache(provisional, beatmapsetId);
  if (!cache || (!cache.artist && !cache.title && !cache.creator)) return;

  const existing = existingCache === undefined
    ? await db.get('SELECT metadata_complete FROM beatmap_cache WHERE beatmapset_id = ?', beatmapsetId)
    : existingCache;
  if (existing?.metadata_complete) return;

  await db.run(`
    INSERT INTO beatmap_cache (
      beatmapset_id, artist, title, creator, creator_id, cover_url, local_cover_path,
      ranked_status, difficulties_json, metadata_complete, last_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, CURRENT_TIMESTAMP)
    ON CONFLICT(beatmapset_id) DO UPDATE SET
      artist = excluded.artist, title = excluded.title, creator = excluded.creator,
      creator_id = excluded.creator_id, cover_url = excluded.cover_url,
      local_cover_path = excluded.local_cover_path, ranked_status = excluded.ranked_status,
      difficulties_json = '[]', metadata_complete = 0, last_updated = CURRENT_TIMESTAMP
    WHERE beatmap_cache.metadata_complete = 0
  `, [
    cache.beatmapsetId, cache.artist, cache.title, cache.creator, cache.creatorId,
    cache.coverUrl, '/uploads/covers/default.jpg', cache.rankedStatus
  ]);
}

async function queueBeatmapMetadata(db, beatmapsetId, provisional = null) {
  const cached = await db.get('SELECT metadata_complete FROM beatmap_cache WHERE beatmapset_id = ?', beatmapsetId);
  if (cached?.metadata_complete) return 'available';

  await seedProvisionalCache(db, beatmapsetId, provisional, cached);
  const existing = await db.get('SELECT status FROM beatmap_metadata_sync WHERE beatmapset_id = ?', beatmapsetId);
  if (!existing) {
    await db.run(`
      INSERT OR IGNORE INTO beatmap_metadata_sync (beatmapset_id, status, attempt_count, next_attempt_at)
      VALUES (?, 'Pending', 0, CURRENT_TIMESTAMP)
    `, beatmapsetId);
  } else if (existing.status === 'Completed') {
    await db.run(`
      UPDATE beatmap_metadata_sync
      SET status = 'Pending', attempt_count = 0, last_error = NULL, next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE beatmapset_id = ?
    `, beatmapsetId);
  }

  return existing?.status === 'Failed' ? 'failed' : 'queued';
}

async function enqueueBeatmapMetadata(db, beatmapsetId, provisional = null) {
  const state = await queueBeatmapMetadata(db, beatmapsetId, provisional);
  if (state === 'queued') kickMetadataSyncWorker();
  return state;
}

async function enqueueBeatmapRefresh(db, beatmapsetId) {
  await db.run(`
    INSERT INTO beatmap_metadata_sync (beatmapset_id, status, attempt_count, last_error, next_attempt_at, updated_at)
    VALUES (?, 'Pending', 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(beatmapset_id) DO UPDATE SET
      status = 'Pending', attempt_count = 0, last_error = NULL,
      next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  `, beatmapsetId);
  kickMetadataSyncWorker();
}

function scheduleWake(nextAttemptAt) {
  if (!nextAttemptAt || wakeTimer) return;
  const normalizedTime = nextAttemptAt.includes('T') ? nextAttemptAt : `${nextAttemptAt.replace(' ', 'T')}Z`;
  const delay = Math.max(0, new Date(normalizedTime).getTime() - Date.now());
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    kickMetadataSyncWorker();
  }, delay);
  wakeTimer.unref?.();
}

async function runMetadataSyncWorker() {
  const db = await getDatabase();
  while (true) {
    if (pauseRequested) {
      return;
    }
    const row = await db.get(`
      SELECT * FROM beatmap_metadata_sync
      WHERE status = 'Pending' AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
      ORDER BY created_at, beatmapset_id
      LIMIT 1
    `);
    if (!row) {
      const next = await db.get(`
        SELECT next_attempt_at FROM beatmap_metadata_sync
        WHERE status = 'Pending' AND next_attempt_at IS NOT NULL
        ORDER BY next_attempt_at LIMIT 1
      `);
      scheduleWake(next?.next_attempt_at);
      return;
    }

    const needed = await db.get('SELECT id FROM requests WHERE beatmapset_id = ? LIMIT 1', row.beatmapset_id);
    if (!needed) {
      await db.run(`
        UPDATE beatmap_metadata_sync
        SET status = 'Completed', last_error = NULL, next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE beatmapset_id = ?
      `, row.beatmapset_id);
      continue;
    }

    await processMetadataSyncEntry(db, row);
  }
}

async function processMetadataSyncEntry(db, row, refresh = refreshAndCacheBeatmapset) {
  const claimed = await db.run(`
    UPDATE beatmap_metadata_sync SET status = 'Processing', updated_at = CURRENT_TIMESTAMP
    WHERE beatmapset_id = ? AND status = 'Pending'
  `, row.beatmapset_id);
  if (!claimed.changes) return false;

  try {
    await refresh(db, row.beatmapset_id);
    await db.run('UPDATE beatmap_cache SET metadata_complete = 1 WHERE beatmapset_id = ?', row.beatmapset_id);
    await db.run(`
      UPDATE beatmap_metadata_sync
      SET status = 'Completed', last_error = NULL, next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE beatmapset_id = ? AND status = 'Processing'
    `, row.beatmapset_id);
  } catch (error) {
    const attemptCount = row.attempt_count + 1;
    if (attemptCount >= MAX_ATTEMPTS) {
      await db.run(`
        UPDATE beatmap_metadata_sync
        SET status = 'Failed', attempt_count = ?, last_error = ?, next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE beatmapset_id = ? AND status = 'Processing'
      `, attemptCount, error.message, row.beatmapset_id);
    } else {
      const nextAttemptAt = sqliteTimestamp(new Date(Date.now() + RETRY_DELAYS_MS[attemptCount - 1]));
      await db.run(`
        UPDATE beatmap_metadata_sync
        SET status = 'Pending', attempt_count = ?, last_error = ?, next_attempt_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE beatmapset_id = ? AND status = 'Processing'
      `, attemptCount, error.message, nextAttemptAt, row.beatmapset_id);
    }
  }
  return true;
}

function kickMetadataSyncWorker() {
  if (workerRunning || pauseRequested) return;
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  workerRunning = true;
  const currentWorker = new Promise(resolve => setImmediate(resolve)).then(() => runMetadataSyncWorker()).catch(async error => {
    console.error('[metadata-sync] Worker stopped unexpectedly:', error.message);
    try {
      const db = await getDatabase();
      await db.run(`
        UPDATE beatmap_metadata_sync
        SET status = 'Pending', next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE status = 'Processing'
      `);
    } catch (recoveryError) {
      console.error('[metadata-sync] Could not recover processing entries:', recoveryError.message);
    }
    if (!pauseRequested) scheduleWake(new Date(Date.now() + 5000).toISOString());
  }).finally(() => {
    if (workerPromise === currentWorker) {
      workerRunning = false;
      workerPromise = null;
    }
  });
  workerPromise = currentWorker;
}

async function initializeMetadataSyncWorker() {
  const db = await getDatabase();
  pauseRequested = false;
  await db.run(`
    UPDATE beatmap_metadata_sync
    SET next_attempt_at = strftime('%Y-%m-%d %H:%M:%S', next_attempt_at)
    WHERE next_attempt_at LIKE '%T%'
  `);
  await db.run(`
    UPDATE beatmap_metadata_sync
    SET status = 'Pending', next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE status = 'Processing'
  `);
  await db.run(`
    INSERT OR IGNORE INTO beatmap_metadata_sync (beatmapset_id, status, attempt_count, next_attempt_at)
    SELECT DISTINCT r.beatmapset_id, 'Pending', 0, CURRENT_TIMESTAMP
    FROM requests r
    LEFT JOIN beatmap_cache b ON b.beatmapset_id = r.beatmapset_id
    WHERE r.beatmapset_id IS NOT NULL AND (b.beatmapset_id IS NULL OR b.metadata_complete = 0)
  `);
  await db.run(`
    UPDATE beatmap_metadata_sync
    SET status = 'Pending', attempt_count = 0, last_error = NULL, next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE status = 'Completed' AND beatmapset_id IN (
      SELECT r.beatmapset_id FROM requests r
      LEFT JOIN beatmap_cache b ON b.beatmapset_id = r.beatmapset_id
      WHERE r.beatmapset_id IS NOT NULL AND (b.beatmapset_id IS NULL OR b.metadata_complete = 0)
    )
  `);
  kickMetadataSyncWorker();
}

async function pauseMetadataSyncWorker() {
  pauseRequested = true;
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  await workerPromise;
}

async function getMetadataSyncStatus(db) {
  const rows = await db.all('SELECT status, COUNT(*) AS count FROM beatmap_metadata_sync GROUP BY status');
  const counts = { Pending: 0, Processing: 0, Completed: 0, Failed: 0 };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

async function retryFailedMetadata(db) {
  const result = await db.run(`
    UPDATE beatmap_metadata_sync
    SET status = 'Pending', attempt_count = 0, last_error = NULL, next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE status = 'Failed'
  `);
  if (result.changes) kickMetadataSyncWorker();
  return result.changes || 0;
}

module.exports = {
  enqueueBeatmapMetadata,
  enqueueBeatmapRefresh,
  getMetadataSyncStatus,
  initializeMetadataSyncWorker,
  pauseMetadataSyncWorker,
  processMetadataSyncEntry,
  queueBeatmapMetadata,
  retryFailedMetadata
};
