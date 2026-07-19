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
  await dbInstance.run('PRAGMA busy_timeout = 5000');
  await dbInstance.run('PRAGMA journal_mode = WAL');
  await dbInstance.run('PRAGMA synchronous = NORMAL');
  await dbInstance.run('PRAGMA temp_store = MEMORY');

  // Initialize schema
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
      input_link TEXT,
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
      submitted_date TEXT,
      metadata_complete INTEGER NOT NULL DEFAULT 1,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS beatmap_metadata_sync (
      beatmapset_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('Pending', 'Processing', 'Completed', 'Failed')) DEFAULT 'Pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  await addColumnIfMissing(dbInstance, 'beatmap_cache', 'submitted_date', 'TEXT');
  await addColumnIfMissing(dbInstance, 'beatmap_cache', 'metadata_complete', 'INTEGER NOT NULL DEFAULT 1');
  await addColumnIfMissing(dbInstance, 'requests', 'guest_difficulty_target_sr', 'REAL');
  await addColumnIfMissing(dbInstance, 'requests', 'guest_difficulty_name', 'TEXT');
  await addColumnIfMissing(dbInstance, 'requests', 'input_link', 'TEXT');
  await migrateRequestSchema(dbInstance);
  await runApplicationMigrations(dbInstance);
  const foreignKeyErrors = await dbInstance.all('PRAGMA foreign_key_check');
  if (foreignKeyErrors.length > 0) {
    throw new Error(`Database migration integrity check failed (${foreignKeyErrors.length} foreign-key errors).`);
  }
  await ensureIndexes(dbInstance);

  // Persist legacy difficulty refreshes in the normal metadata queue so startup
  // never launches a second long-running API loop alongside the worker.
  await queueDifficultyCreatorMigration(dbInstance);

  return dbInstance;
}

async function ensureIndexes(db) {
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_beatmapset_id
      ON requests(beatmapset_id);
    CREATE INDEX IF NOT EXISTS idx_requests_added_date
      ON requests(added_date DESC);
    CREATE INDEX IF NOT EXISTS idx_requests_status_deadline
      ON requests(request_status, deadline);
    CREATE INDEX IF NOT EXISTS idx_request_categories_request_category
      ON request_categories(request_id, category_name);
    CREATE INDEX IF NOT EXISTS idx_request_categories_category_id
      ON request_categories(category_id, request_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_request_categories_unique_category
      ON request_categories(request_id, category_id)
      WHERE category_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_guest_difficulties_request_sort
      ON request_guest_difficulties(request_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_history_request_created
      ON history(request_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_request_tags_tag_request
      ON request_tags(tag_id, request_id);
    CREATE INDEX IF NOT EXISTS idx_metadata_sync_queue
      ON beatmap_metadata_sync(status, next_attempt_at, created_at, beatmapset_id);
  `);
}

async function queueDifficultyCreatorMigration(db) {
  await db.run(`
    INSERT INTO beatmap_metadata_sync (beatmapset_id, status, attempt_count, next_attempt_at)
    SELECT b.beatmapset_id, 'Pending', 0, CURRENT_TIMESTAMP
    FROM beatmap_cache b
    WHERE b.metadata_complete = 1
      AND (b.difficulties_json NOT LIKE '%creator_names%' OR b.difficulties_json NOT LIKE '%"mode":%')
      AND EXISTS (SELECT 1 FROM requests r WHERE r.beatmapset_id = b.beatmapset_id)
    ON CONFLICT(beatmapset_id) DO UPDATE SET
      status = CASE
        WHEN beatmap_metadata_sync.status = 'Processing' THEN 'Processing'
        WHEN beatmap_metadata_sync.status = 'Failed' THEN 'Failed'
        ELSE 'Pending'
      END,
      attempt_count = CASE WHEN beatmap_metadata_sync.status = 'Failed' THEN beatmap_metadata_sync.attempt_count ELSE 0 END,
      next_attempt_at = CASE
        WHEN beatmap_metadata_sync.status = 'Processing' THEN beatmap_metadata_sync.next_attempt_at
        WHEN beatmap_metadata_sync.status = 'Failed' THEN NULL
        ELSE CURRENT_TIMESTAMP
      END,
      updated_at = CURRENT_TIMESTAMP
  `);
}

const BUILTIN_CATEGORIES = [
  ['Hitsounds', 'hitsounds', 'standard', 0],
  ['Guest Difficulties', 'guest_difficulties', 'guest_difficulties', 1],
  ['Storyboards', 'storyboards', 'tagged', 2],
  ['Others', 'others', 'tagged', 3],
];

async function runApplicationMigrations(db) {
  const appliedRows = await db.all('SELECT version FROM schema_migrations');
  const applied = new Set(appliedRows.map(row => row.version));

  if (!applied.has(1)) {
    await db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT COLLATE NOCASE NOT NULL UNIQUE,
          system_key TEXT UNIQUE,
          view_type TEXT NOT NULL CHECK(view_type IN ('standard', 'guest_difficulties', 'tagged')) DEFAULT 'tagged',
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS request_guest_difficulties (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id INTEGER NOT NULL,
          beatmap_id INTEGER,
          difficulty_name TEXT,
          gamemode TEXT NOT NULL CHECK(gamemode IN ('osu', 'taiko', 'fruits', 'mania')) DEFAULT 'osu',
          target_sr REAL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE
        );
      `);

      for (const [name, systemKey, viewType, sortOrder] of BUILTIN_CATEGORIES) {
        await db.run(`
          INSERT INTO categories (name, system_key, view_type, sort_order, is_active)
          VALUES (?, ?, ?, ?, 1)
          ON CONFLICT(name) DO UPDATE SET
            system_key = COALESCE(categories.system_key, excluded.system_key),
            view_type = CASE WHEN categories.system_key IS NULL THEN categories.view_type ELSE excluded.view_type END
        `, name, systemKey, viewType, sortOrder);
      }

      const requestCategoryColumns = await db.all('PRAGMA table_info(request_categories)');
      if (!requestCategoryColumns.some(column => column.name === 'category_id')) {
        await db.run('ALTER TABLE request_categories ADD COLUMN category_id INTEGER REFERENCES categories(id)');
      }

      await db.run(`
        INSERT OR IGNORE INTO categories (name, view_type, sort_order, is_active)
        SELECT DISTINCT trim(category_name), 'tagged',
          (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories), 1
        FROM request_categories
        WHERE trim(COALESCE(category_name, '')) <> ''
      `);
      await db.run(`
        UPDATE request_categories
        SET category_id = (
          SELECT id FROM categories WHERE name = request_categories.category_name COLLATE NOCASE
        )
        WHERE category_id IS NULL
      `);

      await db.run(`
        INSERT INTO request_guest_difficulties (
          request_id, difficulty_name, gamemode, target_sr, sort_order
        )
        SELECT id, guest_difficulty_name, 'osu', guest_difficulty_target_sr, 0
        FROM requests
        WHERE (guest_difficulty_name IS NOT NULL OR guest_difficulty_target_sr IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM request_guest_difficulties gd WHERE gd.request_id = requests.id
          )
      `);

      // Merge legacy tags that differ only by case before enforcing catalog uniqueness.
      await db.run(`
        INSERT OR IGNORE INTO request_tags (request_id, tag_id)
        SELECT rt.request_id, canonical.id
        FROM request_tags rt
        JOIN tags duplicate ON duplicate.id = rt.tag_id
        JOIN tags canonical ON lower(canonical.name) = lower(duplicate.name)
          AND canonical.id = (SELECT MIN(t2.id) FROM tags t2 WHERE lower(t2.name) = lower(duplicate.name))
      `);
      await db.run(`
        DELETE FROM tags
        WHERE id NOT IN (SELECT MIN(id) FROM tags GROUP BY lower(name))
      `);
      await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_nocase ON tags(name COLLATE NOCASE)');

      await db.run(
        'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
        1,
        'dynamic categories, guest difficulty rows, and case-insensitive tags'
      );
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
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
async function migrateRequestSchema(db) {
  const table = await db.get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'requests'");
  if (!table?.sql || (table.sql.includes("'Considering'") && table.sql.includes("DEFAULT 'Low'"))) return;

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
    'input_link',
    'discord_link',
    'osu_profile_link',
    'added_date',
    'completed_date',
    'last_updated',
    'guest_difficulty_target_sr',
    'guest_difficulty_name'
  ];
  const existingColumnRows = await db.all('PRAGMA table_info(requests)');
  const existingColumns = new Set(existingColumnRows.map(column => column.name));
  const unknownColumns = existingColumnRows.filter(column => !requestColumns.includes(column.name));
  const preservedDefinitions = unknownColumns
    .map(column => `"${column.name.replace(/"/g, '""')}" ${column.type || 'TEXT'}`)
    .join(', ');
  const columnsToCopy = requestColumns.filter(column => existingColumns.has(column));
  const columnList = [...columnsToCopy, ...unknownColumns.map(column => `"${column.name.replace(/"/g, '""')}"`)].join(', ');

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
        input_link TEXT,
        discord_link TEXT,
        osu_profile_link TEXT,
        added_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_date DATETIME,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        guest_difficulty_target_sr REAL,
        guest_difficulty_name TEXT
      ${preservedDefinitions ? `, ${preservedDefinitions}` : ''}
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
  coversDir,
  BUILTIN_CATEGORIES,
  runApplicationMigrations,
};
