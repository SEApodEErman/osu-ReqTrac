const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { runApplicationMigrations } = require('../src/db');
const { normalizeGuestDifficulties, replaceGuestDifficulties } = require('../src/utils/catalog');
const { findUserDifficulties } = require('../src/utils/requestUtils');

test('application migration backfills dynamic categories, guest rows, and case-insensitive tags idempotently', async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.run('PRAGMA foreign_keys = ON');
  await db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE requests (
      id INTEGER PRIMARY KEY,
      guest_difficulty_target_sr REAL,
      guest_difficulty_name TEXT,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE request_categories (
      id INTEGER PRIMARY KEY,
      request_id INTEGER NOT NULL,
      category_name TEXT NOT NULL,
      other_text TEXT,
      status TEXT,
      FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE
    );
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
    CREATE TABLE request_tags (
      request_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY(request_id, tag_id),
      FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    INSERT INTO requests (id, guest_difficulty_target_sr, guest_difficulty_name)
      VALUES (1, 6.4, 'Collab Expert');
    INSERT INTO request_categories VALUES (1, 1, 'Custom Art', NULL, 'Pending');
    INSERT INTO tags VALUES (1, 'Tournament'), (2, 'tournament');
    INSERT INTO request_tags VALUES (1, 1), (1, 2);
  `);

  await runApplicationMigrations(db);
  await runApplicationMigrations(db);

  assert.equal((await db.get('SELECT COUNT(*) AS count FROM categories')).count, 5);
  assert.equal((await db.get('SELECT category_id FROM request_categories WHERE id = 1')).category_id > 0, true);
  assert.deepEqual(
    await db.get('SELECT difficulty_name, gamemode, target_sr FROM request_guest_difficulties WHERE request_id = 1'),
    { difficulty_name: 'Collab Expert', gamemode: 'osu', target_sr: 6.4 }
  );
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM tags')).count, 1);
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 1')).count, 1);
  assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
  await db.close();
});

test('guest difficulty normalization accepts four modes and filters empty rows', () => {
  assert.deepEqual(normalizeGuestDifficulties([
    { beatmap_id: '42', difficulty_name: ' Oni ', gamemode: 'taiko', target_sr: '5.25' },
    { difficulty_name: '', target_sr: '', gamemode: 'invalid' },
    { difficulty_name: 'Catch Cup', gamemode: 'fruits' },
  ]), [
    { beatmap_id: 42, difficulty_name: 'Oni', gamemode: 'taiko', target_sr: 5.25, sort_order: 0 },
    { beatmap_id: null, difficulty_name: 'Catch Cup', gamemode: 'fruits', target_sr: null, sort_order: 2 },
  ]);
});

test('plural guest resolver merges account-owned and manually assigned difficulties without duplicates', () => {
  const difficulties = [
    { id: 1, name: 'Expert', mode: 'osu', creator_ids: [10] },
    { id: 2, name: 'Oni', mode: 'taiko', creator_ids: [20] },
  ];
  const matches = findUserDifficulties(difficulties, {
    connectedUserId: 10,
    assignments: [
      { beatmap_id: 1, gamemode: 'osu' },
      { difficulty_name: 'Oni', gamemode: 'taiko' },
    ],
  });
  assert.deepEqual(matches.map(row => row.id), [1, 2]);
});

test('guest difficulty replacement is compatible, mode-aware, and transaction-safe for existing requests', async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.run('PRAGMA foreign_keys = ON');
  await db.exec(`
    CREATE TABLE requests (
      id INTEGER PRIMARY KEY,
      guest_difficulty_target_sr REAL,
      guest_difficulty_name TEXT,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE request_guest_difficulties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      beatmap_id INTEGER,
      difficulty_name TEXT,
      gamemode TEXT NOT NULL,
      target_sr REAL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE
    );
    CREATE TABLE history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      details TEXT NOT NULL
    );
    INSERT INTO requests (id, guest_difficulty_target_sr, guest_difficulty_name)
      VALUES (1, 5.5, 'Old Expert');
    INSERT INTO request_guest_difficulties
      (request_id, beatmap_id, difficulty_name, gamemode, target_sr, sort_order)
      VALUES (1, 100, 'Old Expert', 'osu', 5.5, 0);
  `);

  const nextRows = normalizeGuestDifficulties([
    { beatmap_id: 200, difficulty_name: 'Oni', gamemode: 'taiko', target_sr: 6.2 },
    { beatmap_id: 300, difficulty_name: 'Four', gamemode: 'mania', target_sr: 7.1 },
  ]);
  await db.exec('BEGIN TRANSACTION');
  await replaceGuestDifficulties(db, 1, nextRows);
  await db.run('INSERT INTO history (request_id, action_type, details) VALUES (?, ?, ?)', 1, 'guest_difficulties_added', '2 guest difficulties added.');
  await db.exec('COMMIT');

  assert.deepEqual(
    await db.all('SELECT beatmap_id, difficulty_name, gamemode, target_sr FROM request_guest_difficulties WHERE request_id = 1 ORDER BY sort_order'),
    [
      { beatmap_id: 200, difficulty_name: 'Oni', gamemode: 'taiko', target_sr: 6.2 },
      { beatmap_id: 300, difficulty_name: 'Four', gamemode: 'mania', target_sr: 7.1 },
    ]
  );
  assert.deepEqual(await db.get('SELECT guest_difficulty_name, guest_difficulty_target_sr FROM requests WHERE id = 1'), {
    guest_difficulty_name: 'Oni',
    guest_difficulty_target_sr: 6.2,
  });
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM history WHERE request_id = 1')).count, 1);

  await replaceGuestDifficulties(db, 1, normalizeGuestDifficulties([], {
    guest_difficulty_name: 'Legacy Expert',
    guest_difficulty_target_sr: 6.4,
  }));
  assert.deepEqual(
    await db.get('SELECT difficulty_name, gamemode, target_sr FROM request_guest_difficulties WHERE request_id = 1'),
    { difficulty_name: 'Legacy Expert', gamemode: 'osu', target_sr: 6.4 }
  );

  await db.exec('BEGIN TRANSACTION');
  try {
    await replaceGuestDifficulties(db, 1, []);
    await db.run('INSERT INTO history (request_id, action_type, details) VALUES (?, ?, ?)', 1, 'guest_difficulties_removed', '1 guest difficulty removed.');
    await db.run('INSERT INTO missing_table (request_id) VALUES (?)', 1);
    await db.exec('COMMIT');
  } catch {
    await db.exec('ROLLBACK');
  }
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM request_guest_difficulties WHERE request_id = 1')).count, 1);
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM history WHERE request_id = 1')).count, 1);

  await replaceGuestDifficulties(db, 1, []);
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM request_guest_difficulties WHERE request_id = 1')).count, 0);
  assert.deepEqual(await db.get('SELECT guest_difficulty_name, guest_difficulty_target_sr FROM requests WHERE id = 1'), {
    guest_difficulty_name: null,
    guest_difficulty_target_sr: null,
  });
  await db.close();
});
