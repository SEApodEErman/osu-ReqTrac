const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../src/db');
const osuApiModulePath = require.resolve('../src/osuApi');
const originalDbModule = require.cache[dbModulePath];
const originalFetch = global.fetch;
const originalDateNow = Date.now;

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function loadOsuApi(handleApiRequest) {
  const apiCalls = [];
  let oauthCalls = 0;

  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: {
      coversDir: '',
      getDatabase: async () => ({
        get: async (_query, key) => ({ value: key === 'osu_client_id' ? '1' : 'secret' }),
      }),
    },
  };
  delete require.cache[osuApiModulePath];

  let now = 1_000_000;
  Date.now = () => {
    now += 3000;
    return now;
  };
  global.fetch = async (url) => {
    if (url === 'https://osu.ppy.sh/oauth/token') {
      oauthCalls++;
      return jsonResponse({ access_token: 'token', expires_in: 3600 });
    }

    const parsedUrl = new URL(url);
    apiCalls.push(parsedUrl);
    return handleApiRequest(parsedUrl, apiCalls.length);
  };

  return { osuApi: require(osuApiModulePath), apiCalls, getOauthCalls: () => oauthCalls };
}

test.afterEach(() => {
  delete require.cache[osuApiModulePath];
  if (originalDbModule) {
    require.cache[dbModulePath] = originalDbModule;
  } else {
    delete require.cache[dbModulePath];
  }
  global.fetch = originalFetch;
  Date.now = originalDateNow;
});

test('fetchBeatmaps returns immediately for empty input', async () => {
  const { osuApi, apiCalls } = loadOsuApi(() => {
    throw new Error('The API should not be called');
  });

  assert.deepEqual(await osuApi.fetchBeatmaps([]), []);
  assert.equal(apiCalls.length, 0);
});

test('fetchBeatmaps preserves order, duplicates, and nulls for invalid or missing IDs', async () => {
  const { osuApi, apiCalls } = loadOsuApi((url) => {
    const ids = url.searchParams.getAll('ids[]').map(Number);
    assert.deepEqual(ids, [3, 1, 999]);
    return jsonResponse({ beatmaps: [{ id: 1 }, { id: 3 }] });
  });

  const result = await osuApi.fetchBeatmaps([3, 1, 3, 999, 'invalid']);

  assert.deepEqual(result.map(beatmap => beatmap?.id ?? null), [3, 1, 3, null, null]);
  assert.equal(apiCalls.length, 1);
});

test('fetchBeatmaps sends exactly 50 IDs in one request', async () => {
  const ids = Array.from({ length: 50 }, (_, index) => index + 1);
  const { osuApi, apiCalls } = loadOsuApi((url) => {
    const requestedIds = url.searchParams.getAll('ids[]').map(Number);
    return jsonResponse({ beatmaps: requestedIds.map(id => ({ id })) });
  });

  const result = await osuApi.fetchBeatmaps(ids);

  assert.deepEqual(result.map(beatmap => beatmap.id), ids);
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].searchParams.getAll('ids[]').length, 50);
});

test('fetchBeatmaps splits more than 50 IDs into ordered batches', async () => {
  const ids = Array.from({ length: 120 }, (_, index) => index + 1);
  const batchSizes = [];
  const { osuApi, apiCalls } = loadOsuApi((url) => {
    const requestedIds = url.searchParams.getAll('ids[]').map(Number);
    batchSizes.push(requestedIds.length);
    return jsonResponse({ beatmaps: requestedIds.reverse().map(id => ({ id })) });
  });

  const result = await osuApi.fetchBeatmaps(ids);

  assert.deepEqual(batchSizes, [50, 50, 20]);
  assert.deepEqual(result.map(beatmap => beatmap.id), ids);
  assert.equal(apiCalls.length, 3);
});

test('fetchBeatmaps keeps successful batches when another batch fails', async (t) => {
  t.mock.method(console, 'error', () => {});
  const ids = Array.from({ length: 75 }, (_, index) => index + 1);
  const failedBatches = [];
  const { osuApi, apiCalls } = loadOsuApi((url, callNumber) => {
    const requestedIds = url.searchParams.getAll('ids[]').map(Number);
    if (callNumber === 2) {
      return jsonResponse({ error: 'temporary failure' }, 500);
    }
    return jsonResponse({ beatmaps: requestedIds.map(id => ({ id })) });
  });

  const result = await osuApi.fetchBeatmaps(ids, {
    onBatchError: batch => failedBatches.push(batch)
  });

  assert.deepEqual(result.slice(0, 50).map(beatmap => beatmap.id), ids.slice(0, 50));
  assert.deepEqual(result.slice(50), Array(25).fill(null));
  assert.deepEqual(failedBatches, [ids.slice(50)]);
  assert.equal(apiCalls.length, 2);
});

test('fetchBeatmap keeps its existing single-beatmap response format', async () => {
  const expected = { id: 42, beatmapset_id: 7 };
  const { osuApi, apiCalls } = loadOsuApi((url) => {
    assert.equal(url.pathname, '/api/v2/beatmaps/42');
    return jsonResponse(expected);
  });

  assert.deepEqual(await osuApi.fetchBeatmap(42), expected);
  assert.equal(apiCalls.length, 1);
});

test('concurrent API calls share one OAuth request and remain individually queued', async () => {
  let activeRequests = 0;
  let maxActiveRequests = 0;
  const { osuApi, apiCalls, getOauthCalls } = loadOsuApi(async (url) => {
    activeRequests++;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    await Promise.resolve();
    const id = Number(url.pathname.split('/').at(-1));
    activeRequests--;
    return jsonResponse({ id });
  });

  const result = await Promise.all([1, 2, 3].map(id => osuApi.fetchBeatmap(id)));

  assert.deepEqual(result.map(beatmap => beatmap.id), [1, 2, 3]);
  assert.equal(getOauthCalls(), 1);
  assert.equal(maxActiveRequests, 1);
  assert.deepEqual(apiCalls.map(url => url.pathname), [
    '/api/v2/beatmaps/1',
    '/api/v2/beatmaps/2',
    '/api/v2/beatmaps/3'
  ]);
});
