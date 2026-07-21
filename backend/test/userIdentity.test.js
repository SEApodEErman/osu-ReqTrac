const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const {
  canonicalDifficultyNames,
  getUnavailableUserIds,
  recordUnavailableUser,
  recordUserIdentity,
} = require('../src/utils/userIdentity');

test('creator identity keeps aliases while displaying the latest username', async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE users_cache (id INTEGER PRIMARY KEY, username TEXT NOT NULL, avatar_url TEXT NOT NULL, country_code TEXT NOT NULL, last_updated DATETIME);
    CREATE TABLE user_username_history (user_id INTEGER NOT NULL, username TEXT COLLATE NOCASE NOT NULL, first_seen DATETIME, last_seen DATETIME, PRIMARY KEY (user_id, username));
  `);
  await recordUserIdentity(db, { id: 42, username: '-AzuMI', avatar_url: 'a', country_code: 'MY' });
  await recordUserIdentity(db, { id: 42, username: 'Mita' });

  const user = await db.get('SELECT * FROM users_cache WHERE id = 42');
  const aliases = await db.all('SELECT username FROM user_username_history WHERE user_id = 42 ORDER BY username');
  assert.equal(user.username, 'Mita');
  assert.deepEqual(aliases.map(row => row.username), ['-AzuMI', 'Mita']);
  assert.deepEqual(canonicalDifficultyNames({ creator_id: 42, creator_name: '-AzuMI' }, new Map([[42, user]])).creator_names, ['Mita']);
  await db.close();
});

test('unavailable users are persisted once by stable positive user ID', async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE unavailable_osu_users (
      user_id INTEGER PRIMARY KEY CHECK(user_id > 0),
      username TEXT COLLATE NOCASE,
      first_failed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  assert.equal(await recordUnavailableUser(db, 0, 'Invalid'), null);
  await recordUnavailableUser(db, 42, 'DeletedUser');
  await recordUnavailableUser(db, 42, 'ChangedName');

  assert.deepEqual(await db.all('SELECT user_id, username FROM unavailable_osu_users'), [
    { user_id: 42, username: 'DeletedUser' },
  ]);
  assert.deepEqual([...await getUnavailableUserIds(db)], [42]);
  await db.close();
});
