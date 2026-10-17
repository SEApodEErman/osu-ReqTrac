const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/utils/sqliteAdapter');

const dbModulePath = require.resolve('../src/db');
const osuApiModulePath = require.resolve('../src/osuApi');
const { testUtils } = require('../src/routes/settings');

test('connected user input accepts IDs, profile links, and usernames', () => {
  assert.equal(testUtils.parseUserIdentityInput('  '), null);
  assert.deepEqual(testUtils.parseUserIdentityInput('2'), { id: 2 });
  assert.deepEqual(testUtils.parseUserIdentityInput('https://osu.ppy.sh/users/124493/osu'), { id: 124493 });
  assert.deepEqual(testUtils.parseUserIdentityInput('osu.ppy.sh/u/7562902'), { id: 7562902 });
  assert.deepEqual(testUtils.parseUserIdentityInput('@Mahiru Shiina'), { username: 'Mahiru Shiina' });
});

test('stored preferences tolerate missing or corrupt values', async () => {
  const db = await open({ filename: ':memory:' });
  await db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  assert.deepEqual(await testUtils.readPreferences(db), {});
  await db.run('INSERT INTO settings VALUES (?, ?)', 'ui_preferences', '{broken');
  assert.deepEqual(await testUtils.readPreferences(db), {});
  await db.run('UPDATE settings SET value = ? WHERE key = ?', '{"theme":"light"}', 'ui_preferences');
  assert.deepEqual(await testUtils.readPreferences(db), { theme: 'light' });
  await db.close();
});

test('credential verification reports whether osu! accepts the client credentials', async (t) => {
  const originalFetch = global.fetch;
  const originalDbModule = require.cache[dbModulePath];
  require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { coversDir: '', getDatabase: async () => ({}) } };
  delete require.cache[osuApiModulePath];
  t.after(() => {
    global.fetch = originalFetch;
    if (originalDbModule) require.cache[dbModulePath] = originalDbModule; else delete require.cache[dbModulePath];
    delete require.cache[osuApiModulePath];
  });

  const statuses = [200, 401];
  const bodies = [];
  global.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    const status = statuses.shift();
    return { ok: status === 200, status, json: async () => ({}), text: async () => '' };
  };
  const { verifyCredentials } = require('../src/osuApi');

  assert.deepEqual(await verifyCredentials('12345', 'secret'), { ok: true });
  assert.equal(bodies[0].client_id, 12345);
  const rejected = await verifyCredentials('12345', 'wrong');
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /rejected/);
  assert.match((await verifyCredentials('abc', 'secret')).error, /number/);
  assert.equal(bodies.length, 2);
});
