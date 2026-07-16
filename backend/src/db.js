const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const fs = require('fs');

// Determine data directory — use Electron userData path if available
function getDataDir() {
  if (process.env.ELECTRON_RUN === '1') {
    try {
      const { app } = require('electron');
      const userDataPath = app.getPath('userData');
      return path.join(userDataPath, 'data');
    } catch (e) {
      // Fallback if electron isn't fully loaded yet
    }
  }
  return path.resolve(__dirname, '../data');
}

const dbDir = getDataDir();

// Ensure the data directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'database.sqlite');

// Ensure the local covers directory exists
const coversDir = path.join(dbDir, 'covers');
if (!fs.existsSync(coversDir)) {
  fs.mkdirSync(coversDir, { recursive: true });
}

let dbInstance = null;

async function getDatabase() {
  if (dbInstance) return dbInstance;

  dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign key support
  await dbInstance.run('PRAGMA foreign_keys = ON');

  // Initialize schema
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      beatmapset_id INTEGER NULL,
      is_osu_link BOOLEAN NOT NULL DEFAULT 1,
      non_osu_artist TEXT,
      non_osu_title TEXT,
      non_osu_creator TEXT,
      non_osu_difficulty TEXT,
      requester_id INTEGER,
      requester_username TEXT,
      request_status TEXT CHECK(request_status IN ('Accepted', 'Considering', 'Working', 'Completed', 'Cancelled')) DEFAULT 'Accepted',
      priority TEXT CHECK(priority IN ('Low', 'Medium', 'High')) DEFAULT 'Low',
      deadline DATE,
      notes TEXT,
      discord_link TEXT,
      osu_profile_link TEXT,
      added_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_date DATETIME,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS request_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      category_name TEXT NOT NULL,
      other_text TEXT,
      status TEXT CHECK(status IN ('Pending', 'Working', 'Completed', 'Cancelled')) DEFAULT 'Pending',
      FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS beatmap_cache (
      beatmapset_id INTEGER PRIMARY KEY,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      creator TEXT NOT NULL,
      creator_id INTEGER NOT NULL,
      cover_url TEXT NOT NULL,
      local_cover_path TEXT NOT NULL,
      ranked_status TEXT NOT NULL,
      difficulties_json TEXT NOT NULL,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users_cache (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      avatar_url TEXT NOT NULL,
      country_code TEXT NOT NULL,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS request_tags (
      request_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY(request_id, tag_id),
      FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Lightweight migrations: add columns that may be missing on older databases
  await addColumnIfMissing(dbInstance, 'beatmap_cache', 'ranked_date', 'TEXT');
  await addColumnIfMissing(dbInstance, 'beatmap_cache', 'osu_last_updated', 'TEXT');
  await addColumnIfMissing(dbInstance, 'requests', 'guest_difficulty_target_sr', 'REAL');
  await addColumnIfMissing(dbInstance, 'requests', 'guest_difficulty_name', 'TEXT');
  await migrateRequestStatusConstraint(dbInstance);

  // Trigger difficulty migration asynchronously to update existing caches
  migrateExistingDifficulties(dbInstance);

  return dbInstance;
}

// Migration to update difficulty creators/owners for old cache entries
async function migrateExistingDifficulties(db) {
  try {
    const expiredMaps = await db.all("SELECT beatmapset_id FROM beatmap_cache WHERE difficulties_json NOT LIKE '%creator_name%'");
    if (expiredMaps.length > 0) {
      console.log(`[db] Found ${expiredMaps.length} beatmapsets in cache needing difficulty owner updates. Migrating...`);
      const { refreshAndCacheBeatmapset } = require('./routes/beatmaps');
      for (const row of expiredMaps) {
        try {
          console.log(`[db] Migrating beatmapset ${row.beatmapset_id}...`);
          await refreshAndCacheBeatmapset(db, row.beatmapset_id);
          // Wait 2 seconds to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (err) {
          console.error(`[db] Failed to migrate beatmapset ${row.beatmapset_id}:`, err.message);
        }
      }
      console.log('[db] Difficulty owner migration finished.');
    }
  } catch (error) {
    console.error('[db] Error in migrateExistingDifficulties:', error.message);
  }
}

// Add a column to a table if it does not already exist
async function addColumnIfMissing(db, table, column, type) {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  const exists = cols.some(c => c.name === column);
  if (!exists) {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`[db] Added missing column ${table}.${column}`);
  }
}

// SQLite does not support altering a CHECK constraint, so rebuild older request
// tables that predate the Considering status while preserving their data.
async function migrateRequestStatusConstraint(db) {
  const table = await db.get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'requests'");
  if (!table?.sql || table.sql.includes("'Considering'")) return;

  const requestColumns = [
    'id',
    'beatmapset_id',
    'is_osu_link',
    'non_osu_artist',
    'non_osu_title',
    'non_osu_creator',
    'non_osu_difficulty',
    'requester_id',
    'requester_username',
    'request_status',
    'priority',
    'deadline',
    'notes',
    'discord_link',
    'osu_profile_link',
    'added_date',
    'completed_date',
    'last_updated',
    'guest_difficulty_target_sr',
    'guest_difficulty_name'
  ];
  const existingColumns = new Set((await db.all('PRAGMA table_info(requests)')).map(column => column.name));
  const columnsToCopy = requestColumns.filter(column => existingColumns.has(column));
  const columnList = columnsToCopy.join(', ');

  await db.exec('PRAGMA foreign_keys = OFF');
  try {
    await db.exec('BEGIN TRANSACTION');
    await db.exec(`
      CREATE TABLE requests_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        beatmapset_id INTEGER NULL,
        is_osu_link BOOLEAN NOT NULL DEFAULT 1,
        non_osu_artist TEXT,
        non_osu_title TEXT,
        non_osu_creator TEXT,
        non_osu_difficulty TEXT,
        requester_id INTEGER,
        requester_username TEXT,
        request_status TEXT CHECK(request_status IN ('Accepted', 'Considering', 'Working', 'Completed', 'Cancelled')) DEFAULT 'Accepted',
        priority TEXT CHECK(priority IN ('Low', 'Medium', 'High')) DEFAULT 'Low',
        deadline DATE,
        notes TEXT,
        discord_link TEXT,
        osu_profile_link TEXT,
        added_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_date DATETIME,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        guest_difficulty_target_sr REAL,
        guest_difficulty_name TEXT
      )
    `);
    await db.exec(`INSERT INTO requests_new (${columnList}) SELECT ${columnList} FROM requests`);
    await db.exec('DROP TABLE requests');
    await db.exec('ALTER TABLE requests_new RENAME TO requests');
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  } finally {
    await db.exec('PRAGMA foreign_keys = ON');
  }
}

module.exports = {
  getDatabase,
  dbPath,
  coversDir
};
