const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/utils/sqliteAdapter');

const osuApiModulePath = require.resolve('../src/osuApi');
const requestsModulePath = require.resolve('../src/routes/requests');
const beatmapsModulePath = require.resolve('../src/routes/beatmaps');

test('date refresh resolves many beatmapsets per osu! call and falls back per set only when needed', async (t) => {
  const realOsuApi = require('../src/osuApi');
  const batchCalls = [];
  const fullRefreshes = [];
  require.cache[osuApiModulePath] = {
    id: osuApiModulePath,
    filename: osuApiModulePath,
    loaded: true,
    exports: {
      ...realOsuApi,
      fetchBeatmaps: async (ids) => {
        batchCalls.push(ids);
        return ids.map(id => id === 201 ? null : {
          id,
          beatmapset: { status: id === 101 ? 'ranked' : 'pending', ranked_date: '2024-05-06T00:00:00Z', last_updated: '2025-07-08T00:00:00Z' },
        });
      },
      fetchBeatmapset: async (id) => {
        fullRefreshes.push(id);
        return null;
      },
    },
  };
  delete require.cache[requestsModulePath];
  delete require.cache[beatmapsModulePath];
  t.after(() => {
    delete require.cache[osuApiModulePath];
    delete require.cache[requestsModulePath];
    delete require.cache[beatmapsModulePath];
  });
  const { testUtils } = require('../src/routes/requests');

  const db = await open({ filename: ':memory:' });
  await db.exec(`
    CREATE TABLE requests (id INTEGER PRIMARY KEY, added_date TEXT, last_updated TEXT);
    CREATE TABLE history (id INTEGER PRIMARY KEY, request_id INTEGER, action_type TEXT, details TEXT);
    CREATE TABLE beatmap_cache (beatmapset_id INTEGER PRIMARY KEY, difficulties_json TEXT, ranked_status TEXT, ranked_date TEXT, osu_last_updated TEXT, submitted_date TEXT);
    INSERT INTO requests (id) VALUES (1), (2), (3);
    INSERT INTO beatmap_cache (beatmapset_id, difficulties_json) VALUES
      (10, '[{"id":101}]'), (20, '[{"id":201}]'), (30, '[]');
  `);

  const rows = [
    { id: 1, beatmapset_id: 10, title: 'Ranked set' },
    { id: 2, beatmapset_id: 20, title: 'Difficulty removed' },
    { id: 3, beatmapset_id: 30, title: 'No cached difficulties' },
  ];
  const job = { status: 'running', total: rows.length, processed: 0, result: testUtils.createRefreshDateResult(), completedAt: null };
  const apiJobId = realOsuApi.createApiJob('test', 0);
  await testUtils.runRefreshDateJob(db, job, rows, apiJobId);

  assert.deepEqual(batchCalls, [[101, 201]]);
  assert.deepEqual(fullRefreshes.sort(), [20, 30]);
  assert.equal(job.status, 'completed');
  assert.equal(job.processed, 3);
  assert.equal(job.result.updated, 1);
  assert.deepEqual(job.result.failed.map(row => row.id).sort(), [2, 3]);
  assert.equal((await db.get('SELECT added_date FROM requests WHERE id = 1')).added_date, '2024-05-06');
  assert.equal((await db.get('SELECT ranked_status FROM beatmap_cache WHERE beatmapset_id = 10')).ranked_status, 'Ranked');
  await db.close();
});

test('representative beatmap IDs skip unreadable or empty difficulty caches', () => {
  const { testUtils } = require('../src/routes/requests');
  const ids = testUtils.representativeBeatmapIds([
    { beatmapset_id: 1, difficulties_json: '[{"id":11},{"id":12}]' },
    { beatmapset_id: 2, difficulties_json: '{broken' },
    { beatmapset_id: 3, difficulties_json: '[{"name":"no id"}]' },
  ]);
  assert.deepEqual([...ids], [[1, 11]]);
  assert.deepEqual(testUtils.lifecycleFromBeatmapset({ status: 'loved', ranked_date: 'r', last_updated: 'u' }), {
    ranked_status: 'Loved', ranked_date: 'r', osu_last_updated: 'u', submitted_date: null,
  });
});
