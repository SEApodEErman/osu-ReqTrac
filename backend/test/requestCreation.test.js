const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/utils/sqliteAdapter');
const { runApplicationMigrations } = require('../src/db');

test('request creation preserves past deadlines and records completion only for completed requests', async (t) => {
  const db = await open({ filename: ':memory:' });
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE requests (
      id INTEGER PRIMARY KEY, beatmapset_id INTEGER, is_osu_link INTEGER,
      non_osu_artist TEXT, non_osu_title TEXT, non_osu_creator TEXT, non_osu_difficulty TEXT,
      requester_id INTEGER, requester_username TEXT, request_status TEXT, priority TEXT,
      deadline TEXT, notes TEXT, input_link TEXT, discord_link TEXT, osu_profile_link TEXT,
      guest_difficulty_target_sr REAL, guest_difficulty_name TEXT, completed_date TEXT,
      last_updated TEXT
    );
    CREATE TABLE request_categories (
      id INTEGER PRIMARY KEY, request_id INTEGER, category_name TEXT, other_text TEXT, status TEXT
    );
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
    CREATE TABLE request_tags (request_id INTEGER, tag_id INTEGER, PRIMARY KEY (request_id, tag_id));
    CREATE TABLE history (id INTEGER PRIMARY KEY, request_id INTEGER, action_type TEXT, details TEXT);
  `);
  await runApplicationMigrations(db);
  const dbModulePath = require.resolve('../src/db');
  const requestsModulePath = require.resolve('../src/routes/requests');
  const originalDbModule = require.cache[dbModulePath];
  const originalRequestsModule = require.cache[requestsModulePath];
  require.cache[dbModulePath] = {
    id: dbModulePath, filename: dbModulePath, loaded: true,
    exports: { ...originalDbModule.exports, getDatabase: async () => db },
  };
  delete require.cache[requestsModulePath];
  t.after(() => {
    require.cache[dbModulePath] = originalDbModule;
    if (originalRequestsModule) require.cache[requestsModulePath] = originalRequestsModule;
    else delete require.cache[requestsModulePath];
  });
  const router = require('../src/routes/requests');
  const create = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods.post).route.stack[0].handle;
  const category = await db.get("SELECT id FROM categories WHERE system_key = 'hitsounds'");

  for (const requestedStatus of ['Completed', 'Considering', 'Accepted', 'Working', undefined, 'invalid']) {
    let responseStatus;
    let responseBody;
    const response = {
      status(code) { responseStatus = code; return this; },
      json(body) { responseBody = body; return this; },
    };
    const beforeCreation = Date.now();
    await create({ body: {
      artist: 'Artist', title: 'Historical request', creator: 'Mapper',
      categories: [{ category_id: category.id }],
      deadline: '2001-02-03', request_status: requestedStatus,
    } }, response, error => { throw error; });

    assert.equal(responseStatus, 201);
    const row = await db.get('SELECT * FROM requests WHERE id = ?', responseBody.requestId);
    assert.equal(row.deadline, '2001-02-03');
    assert.equal(row.request_status, ['Completed', 'Considering', 'Accepted', 'Working'].includes(requestedStatus) ? requestedStatus : 'Accepted');
    if (requestedStatus === 'Completed') {
      assert.ok(Date.parse(row.completed_date) >= beforeCreation);
      assert.ok(Date.parse(row.completed_date) <= Date.now());
    } else {
      assert.equal(row.completed_date, null);
    }
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM request_categories WHERE request_id = ?', row.id)).count, 1);
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM history WHERE request_id = ? AND action_type = 'created'", row.id)).count, 1);
  }
});
