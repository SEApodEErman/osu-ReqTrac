const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { getDashboardStats, resolveStatsCategoryId } = require('../src/routes/stats');

async function createStatsDatabase() {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE requests (
      id INTEGER PRIMARY KEY,
      beatmapset_id INTEGER,
      requester_id INTEGER,
      requester_username TEXT,
      request_status TEXT NOT NULL,
      deadline TEXT,
      completed_date TEXT
    );
    CREATE TABLE request_categories (
      request_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      UNIQUE(request_id, category_id)
    );
    CREATE TABLE beatmap_cache (
      beatmapset_id INTEGER PRIMARY KEY,
      ranked_status TEXT,
      difficulties_json TEXT,
      creator TEXT,
      creator_id INTEGER,
      ranked_date TEXT,
      osu_last_updated TEXT
    );
    CREATE TABLE users_cache (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      avatar_url TEXT,
      country_code TEXT
    );

    INSERT INTO categories VALUES
      (1, 'Hitsounds', 1),
      (2, 'Storyboards', 1),
      (3, 'Archived', 0),
      (4, 'Empty', 1);
    INSERT INTO users_cache VALUES
      (10, 'Alice', 'alice.png', 'MY'),
      (20, 'Bob', 'bob.png', 'US');
    INSERT INTO requests VALUES
      (1, 101, 10, 'OldAlice', 'Completed', NULL, '2025-04-01'),
      (2, 102, 20, 'Bob', 'Working', '2026-07-25', NULL),
      (3, 103, 10, 'Alice', 'Completed', NULL, '2026-02-01');
    INSERT INTO request_categories VALUES
      (1, 1), (1, 2),
      (2, 1),
      (3, 2);
    INSERT INTO beatmap_cache VALUES
      (101, 'Ranked', '[{"drain":600},{"drain":540}]', 'MapperA', 100, '2025-03-01', '2025-03-01'),
      (102, 'Pending', '[{"drain":900}]', 'MapperB', 200, NULL, '2026-07-01'),
      (103, 'Loved', '[{"drain":3600}]', 'MapperC', 300, '2026-01-15', '2026-01-15');
  `);
  return db;
}

test('dashboard statistics scope every panel by category without duplicating multi-category requests', async () => {
  const db = await createStatsDatabase();
  const now = new Date('2026-07-21T00:00:00.000Z');

  const all = await getDashboardStats(db, { now });
  assert.deepEqual(all.overview, { total: 3, active: 1, completed: 2, dueSoon: 1 });
  assert.equal(all.stats.totalDrainTime, '1.2 hours');
  assert.equal(all.requesterBreakdown.find(row => row.username === 'Alice').count, 2);

  const hitsounds = await getDashboardStats(db, { categoryId: 1, now });
  assert.deepEqual(hitsounds.overview, { total: 2, active: 1, completed: 1, dueSoon: 1 });
  assert.deepEqual(hitsounds.stats, {
    completedCount: 1,
    totalDrainTime: '10 minutes',
    rankedCompletedCount: 1,
    mostFrequentRequester: 'Alice',
  });
  assert.deepEqual(hitsounds.yearSummary, [{
    year: 2025,
    completedCount: 1,
    totalDrainTime: '10 minutes',
    mostRequestedUser: 'Alice',
  }]);
  assert.deepEqual(hitsounds.requesterBreakdown.map(row => [row.username, row.count]), [
    ['Alice', 1],
    ['Bob', 1],
  ]);

  const storyboards = await getDashboardStats(db, { categoryId: 2, now });
  assert.deepEqual(storyboards.overview, { total: 2, active: 0, completed: 2, dueSoon: 0 });
  assert.equal(storyboards.stats.totalDrainTime, '1.2 hours');
  assert.equal(storyboards.stats.rankedCompletedCount, 1);
  assert.deepEqual(storyboards.yearSummary.map(row => row.year), [2026, 2025]);

  const empty = await getDashboardStats(db, { categoryId: 4, now });
  assert.deepEqual(empty.overview, { total: 0, active: 0, completed: 0, dueSoon: 0 });
  assert.equal(empty.stats.totalDrainTime, '0 hours');
  assert.deepEqual(empty.yearSummary, []);
  assert.deepEqual(empty.requesterBreakdown, []);

  await db.close();
});

test('dashboard category validation accepts All and rejects invalid or inactive categories', async () => {
  const db = await createStatsDatabase();
  assert.equal(await resolveStatsCategoryId(db, undefined), null);
  assert.equal(await resolveStatsCategoryId(db, 'all'), null);
  assert.equal(await resolveStatsCategoryId(db, '1'), 1);
  await assert.rejects(() => resolveStatsCategoryId(db, 'nope'), { status: 400 });
  await assert.rejects(() => resolveStatsCategoryId(db, '3'), { status: 400 });
  await assert.rejects(() => resolveStatsCategoryId(db, '999'), { status: 400 });
  await db.close();
});
