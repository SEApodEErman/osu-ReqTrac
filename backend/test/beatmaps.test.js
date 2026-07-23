const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const osuApiModulePath = require.resolve('../src/osuApi');
const beatmapsModulePath = require.resolve('../src/routes/beatmaps');
const originalOsuApiModule = require.cache[osuApiModulePath];

test.afterEach(() => {
  delete require.cache[beatmapsModulePath];
  if (originalOsuApiModule) {
    require.cache[osuApiModulePath] = originalOsuApiModule;
  } else {
    delete require.cache[osuApiModulePath];
  }
});

test('refreshAndCacheBeatmapset reuses the embedded creator without a user API call', async () => {
  let beatmapsetRequests = 0;
  let userRequests = 0;
  require.cache[osuApiModulePath] = {
    id: osuApiModulePath,
    filename: osuApiModulePath,
    loaded: true,
    exports: {
      fetchBeatmapset: async () => {
        beatmapsetRequests++;
        return {
          id: 10,
          artist: 'Artist',
          title: 'Title',
          creator: 'Mapper',
          user_id: 20,
          user: { id: 20, username: 'Mapper', avatar_url: 'avatar', country_code: 'JP' },
          covers: { cover: 'cover' },
          status: 'ranked',
          beatmaps: [{ id: 30, version: 'Hard', difficulty_rating: 3, owners: [] }]
        };
      },
      fetchUser: async () => {
        userRequests++;
        return null;
      },
      downloadCover: async () => '/uploads/covers/10.jpg',
      addApiJobWork: () => {},
      updateApiJob: () => {}
    }
  };
  delete require.cache[beatmapsModulePath];
  const { refreshAndCacheBeatmapset } = require(beatmapsModulePath);
  const db = { run: async () => ({}), all: async () => [] };

  await refreshAndCacheBeatmapset(db, 10);

  assert.equal(beatmapsetRequests, 1);
  assert.equal(userRequests, 0);
});

test('startup identity refresh records HTTP 404 users and permanently skips them', async () => {
  const userRequests = [];
  require.cache[osuApiModulePath] = {
    id: osuApiModulePath,
    filename: osuApiModulePath,
    loaded: true,
    exports: {
      fetchBeatmapset: async () => null,
      fetchUser: async (id) => {
        userRequests.push(Number(id));
        if (Number(id) === 20) return null;
        return { id: Number(id), username: 'CurrentUser', avatar_url: 'avatar', country_code: 'MY' };
      },
      downloadCover: async () => null,
      addApiJobWork: () => {},
      updateApiJob: () => {},
    },
  };
  delete require.cache[beatmapsModulePath];
  const { refreshKnownCreatorIdentities } = require(beatmapsModulePath);
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE beatmap_cache (
      beatmapset_id INTEGER PRIMARY KEY,
      creator TEXT,
      creator_id INTEGER,
      difficulties_json TEXT
    );
    CREATE TABLE users_cache (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      avatar_url TEXT NOT NULL,
      country_code TEXT NOT NULL,
      last_updated DATETIME
    );
    CREATE TABLE user_username_history (
      user_id INTEGER NOT NULL,
      username TEXT COLLATE NOCASE NOT NULL,
      first_seen DATETIME,
      last_seen DATETIME,
      PRIMARY KEY (user_id, username)
    );
    CREATE TABLE unavailable_osu_users (
      user_id INTEGER PRIMARY KEY CHECK(user_id > 0),
      username TEXT COLLATE NOCASE,
      first_failed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO settings VALUES ('osu_client_id', 'id'), ('osu_client_secret', 'secret');
    INSERT INTO unavailable_osu_users (user_id, username) VALUES (10, 'AlreadyDeleted');
    INSERT INTO beatmap_cache VALUES (
      1,
      'AlreadyDeleted',
      10,
      '[{"creator_ids":[20,30,0],"creator_names":["RestrictedUser","CurrentUser","InvalidUser"]}]'
    );
  `);

  assert.equal(await refreshKnownCreatorIdentities(db), 1);
  assert.equal(await refreshKnownCreatorIdentities(db), 0);
  assert.deepEqual(userRequests, [20, 30]);
  assert.deepEqual(
    await db.all('SELECT user_id, username FROM unavailable_osu_users ORDER BY user_id'),
    [
      { user_id: 10, username: 'AlreadyDeleted' },
      { user_id: 20, username: 'RestrictedUser' },
    ]
  );
  assert.equal((await db.get('SELECT username FROM users_cache WHERE id = 30')).username, 'CurrentUser');
  await db.close();
});
