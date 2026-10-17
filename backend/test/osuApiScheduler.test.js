const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../src/db');
const osuApiModulePath = require.resolve('../src/osuApi');

function loadOsuApi(t) {
  const originalFetch = global.fetch;
  const originalDbModule = require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: {
      coversDir: '',
      getDatabase: async () => ({ get: async (_query, key) => ({ value: key === 'osu_client_id' ? '1' : 'secret' }) }),
    },
  };
  delete require.cache[osuApiModulePath];

  const calls = [];
  global.fetch = (url) => new Promise(resolve => setImmediate(() => {
    calls.push(String(url));
    const body = String(url).includes('/oauth/token')
      ? { access_token: 'token', expires_in: 86400 }
      : { id: 1, users: [], beatmaps: [] };
    resolve({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  }));

  const osuApi = require('../src/osuApi');
  osuApi.testUtils.setMinRequestIntervals([0, 0, 0]);
  t.after(() => {
    osuApi.testUtils.setMinRequestIntervals();
    global.fetch = originalFetch;
    if (originalDbModule) require.cache[dbModulePath] = originalDbModule;
    else delete require.cache[dbModulePath];
    delete require.cache[osuApiModulePath];
  });
  return { osuApi, calls };
}

const apiPaths = calls => calls.filter(url => !url.includes('/oauth/token')).map(url => url.replace('https://osu.ppy.sh/api/v2/', ''));

test('interactive osu! calls are sent before queued background work', async (t) => {
  const { osuApi, calls } = loadOsuApi(t);
  const background = [1, 2, 3].map(id => osuApi.runWithApiPriority('background', () => osuApi.fetchBeatmapset(id)));
  const interactive = osuApi.runWithApiPriority('interactive', () => osuApi.fetchBeatmapset(99));
  await Promise.all([...background, interactive]);

  assert.deepEqual(apiPaths(calls), ['beatmapsets/99', 'beatmapsets/1', 'beatmapsets/2', 'beatmapsets/3']);
});

test('identical concurrent osu! calls share one request and adopt the higher priority', async (t) => {
  const { osuApi, calls } = loadOsuApi(t);
  const queuedBackground = [1, 2].map(id => osuApi.runWithApiPriority('background', () => osuApi.fetchBeatmapset(id)));
  const duplicateBackground = osuApi.runWithApiPriority('background', () => osuApi.fetchBeatmapset(2));
  const promoted = osuApi.runWithApiPriority('interactive', () => osuApi.fetchBeatmapset(2));
  const results = await Promise.all([...queuedBackground, duplicateBackground, promoted]);

  assert.deepEqual(apiPaths(calls), ['beatmapsets/2', 'beatmapsets/1']);
  assert.equal(results[1], results[3]);
});

test('users are fetched in batches of 50', async (t) => {
  const { osuApi, calls } = loadOsuApi(t);
  const ids = Array.from({ length: 120 }, (_, index) => index + 1);
  await osuApi.fetchUsers([...ids, 5, 'bad', -1]);

  const userCalls = apiPaths(calls);
  assert.equal(userCalls.length, 3);
  assert.equal(new URLSearchParams(userCalls[0].split('?')[1]).getAll('ids[]').length, 50);
  assert.equal(new URLSearchParams(userCalls[2].split('?')[1]).getAll('ids[]').length, 20);
});

test('a just-looked-up beatmapset is reused only when the caller allows it', async (t) => {
  const { osuApi, calls } = loadOsuApi(t);
  await osuApi.fetchBeatmapset(7);
  await osuApi.fetchBeatmapset(7, { maxAgeMs: 60000 });
  assert.deepEqual(apiPaths(calls), ['beatmapsets/7']);
  await osuApi.fetchBeatmapset(7);
  assert.deepEqual(apiPaths(calls), ['beatmapsets/7', 'beatmapsets/7']);
});
