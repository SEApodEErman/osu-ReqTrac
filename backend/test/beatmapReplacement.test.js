const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { replaceRequestBeatmapset, resolveBeatmapsetId } = require('../src/utils/beatmapReplacement');

async function createDatabase() {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE requests (
      id INTEGER PRIMARY KEY,
      beatmapset_id INTEGER,
      is_osu_link INTEGER NOT NULL,
      request_status TEXT,
      priority TEXT,
      notes TEXT,
      last_updated DATETIME
    );
    CREATE TABLE request_guest_difficulties (
      id INTEGER PRIMARY KEY,
      request_id INTEGER NOT NULL,
      beatmap_id INTEGER,
      difficulty_name TEXT NOT NULL,
      gamemode TEXT NOT NULL,
      target_sr REAL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE history (
      id INTEGER PRIMARY KEY,
      request_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      details TEXT NOT NULL
    );
  `);
  return db;
}

test('replacing a mapset preserves request workflow and safely reconciles guest difficulties', async () => {
  const db = await createDatabase();
  await db.exec(`
    INSERT INTO requests (id, beatmapset_id, is_osu_link, request_status, priority, notes)
    VALUES (1, 10, 1, 'Working', 'High', 'Keep these notes');
    INSERT INTO request_guest_difficulties (id, request_id, beatmap_id, difficulty_name, gamemode, target_sr)
    VALUES
      (1, 1, 101, 'Matching Difficulty', 'osu', 4.5),
      (2, 1, 102, 'Removed Difficulty', 'mania', 7.25);
  `);
  const refreshed = [];

  const result = await replaceRequestBeatmapset({
    db,
    requestId: 1,
    link: 'https://osu.ppy.sh/beatmaps/999',
    fetchBeatmap: async id => ({ id, beatmapset_id: 20 }),
    refreshBeatmapset: async (_db, id) => {
      refreshed.push(id);
      return {
        difficulties: [
          { id: 201, name: 'Matching Difficulty', mode: 'osu', stars: 5.1 },
          { id: 202, name: 'Other Difficulty', mode: 'taiko', stars: 3.2 },
        ],
      };
    },
  });

  assert.deepEqual(refreshed, [20]);
  assert.equal(result.beatmapsetId, 20);
  assert.deepEqual(result.guestResult, { refreshed: 1, preservedAsManual: 1 });
  assert.deepEqual(
    await db.get('SELECT beatmapset_id, request_status, priority, notes FROM requests WHERE id = 1'),
    { beatmapset_id: 20, request_status: 'Working', priority: 'High', notes: 'Keep these notes' }
  );
  assert.deepEqual(
    await db.all('SELECT beatmap_id, difficulty_name, gamemode, target_sr FROM request_guest_difficulties ORDER BY id'),
    [
      { beatmap_id: 201, difficulty_name: 'Matching Difficulty', gamemode: 'osu', target_sr: 5.1 },
      { beatmap_id: null, difficulty_name: 'Removed Difficulty', gamemode: 'mania', target_sr: 7.25 },
    ]
  );
  const history = await db.get('SELECT action_type, details FROM history WHERE request_id = 1');
  assert.equal(history.action_type, 'beatmapset_changed');
  assert.match(history.details, /10 to 20/);
  await db.close();
});

test('mapset replacement rejects duplicate and unchanged mapsets before mutating the request', async () => {
  const db = await createDatabase();
  await db.exec(`
    INSERT INTO requests (id, beatmapset_id, is_osu_link, request_status) VALUES
      (1, 10, 1, 'Accepted'),
      (2, 20, 1, 'Working');
  `);

  await assert.rejects(
    replaceRequestBeatmapset({
      db,
      requestId: 1,
      link: 'https://osu.ppy.sh/beatmapsets/20',
      fetchBeatmap: async () => { throw new Error('not reached'); },
      refreshBeatmapset: async () => { throw new Error('not reached'); },
    }),
    error => error.status === 409 && error.requestId === 2
  );
  await assert.rejects(
    replaceRequestBeatmapset({
      db,
      requestId: 1,
      link: 'https://osu.ppy.sh/beatmapsets/10',
      fetchBeatmap: async () => { throw new Error('not reached'); },
      refreshBeatmapset: async () => { throw new Error('not reached'); },
    }),
    error => error.status === 409
  );
  assert.equal((await db.get('SELECT beatmapset_id FROM requests WHERE id = 1')).beatmapset_id, 10);
  await db.close();
});

test('mapset replacement link resolution validates input and resolves beatmap URLs', async () => {
  await assert.rejects(resolveBeatmapsetId('not an osu link', async () => null), error => error.status === 400);
  await assert.rejects(resolveBeatmapsetId('https://osu.ppy.sh/beatmaps/5', async () => null), error => error.status === 400);
  assert.equal(await resolveBeatmapsetId('42', async () => null), 42);
  assert.equal(await resolveBeatmapsetId('https://osu.ppy.sh/beatmapsets/42', async () => null), 42);
});
