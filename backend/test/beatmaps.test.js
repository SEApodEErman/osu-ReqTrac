const test = require('node:test');
const assert = require('node:assert/strict');

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
  const db = { run: async () => ({}) };

  await refreshAndCacheBeatmapset(db, 10);

  assert.equal(beatmapsetRequests, 1);
  assert.equal(userRequests, 0);
});
