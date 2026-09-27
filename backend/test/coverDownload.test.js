const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbModulePath = require.resolve('../src/db');
const osuApiModulePath = require.resolve('../src/osuApi');
const originalDbModule = require.cache[dbModulePath];
const originalFetch = global.fetch;

function loadOsuApi(coversDir) {
  const fetchCalls = [];
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: {
      coversDir,
      getDatabase: async () => ({ get: async () => ({ value: 'x' }) }),
    },
  };
  delete require.cache[osuApiModulePath];
  global.fetch = async (url) => {
    fetchCalls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
      arrayBuffer: async () => new TextEncoder().encode('cover-bytes').buffer,
    };
  };
  return { osuApi: require(osuApiModulePath), fetchCalls };
}

test.afterEach(() => {
  delete require.cache[osuApiModulePath];
  if (originalDbModule) {
    require.cache[dbModulePath] = originalDbModule;
  } else {
    delete require.cache[dbModulePath];
  }
  global.fetch = originalFetch;
});

test('isAllowedCoverUrl only accepts the osu! asset CDN over https', () => {
  const { osuApi } = loadOsuApi('');
  assert.equal(osuApi.isAllowedCoverUrl('https://assets.ppy.sh/beatmaps/10/covers/cover.jpg'), true);
  assert.equal(osuApi.isAllowedCoverUrl('https://assets.ppy.sh/beatmaps/10/covers/cover@2x.jpg'), true);

  assert.equal(osuApi.isAllowedCoverUrl('http://assets.ppy.sh/beatmaps/10/covers/cover.jpg'), false, 'plain http rejected');
  assert.equal(osuApi.isAllowedCoverUrl('https://evil.com/beatmaps/10/covers/cover.jpg'), false);
  assert.equal(osuApi.isAllowedCoverUrl('https://assets.ppy.sh.evil.com/beatmaps/1.jpg'), false);
  assert.equal(osuApi.isAllowedCoverUrl('https://assets.ppy.sh/other/1.jpg'), false, 'non-cover paths rejected');
  assert.equal(osuApi.isAllowedCoverUrl('https://osu.ppy.sh/beatmaps/10/covers/cover.jpg'), false);
  assert.equal(osuApi.isAllowedCoverUrl('file:///etc/passwd'), false);
  assert.equal(osuApi.isAllowedCoverUrl(''), false);
  assert.equal(osuApi.isAllowedCoverUrl(undefined), false);
});

test('downloadCover never fetches attacker-supplied URLs (SSRF guard)', async () => {
  const coversDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reqtrac-cover-'));
  const { osuApi, fetchCalls } = loadOsuApi(coversDir);
  try {
    const result = await osuApi.downloadCover(10, 'http://169.254.169.254/latest/meta-data/');

    assert.deepEqual(fetchCalls, ['https://assets.ppy.sh/beatmaps/10/covers/cover.jpg'],
      'the hostile cover URL must never be requested; only the canonical fallback');
    assert.equal(result, '/uploads/covers/10.jpg');
    const written = await fs.promises.readFile(path.join(coversDir, '10.jpg'));
    assert.equal(written.toString(), 'cover-bytes');
  } finally {
    await fs.promises.rm(coversDir, { recursive: true, force: true });
  }
});

test('downloadCover falls back to the canonical URL for non-CDN hosts', async () => {
  const coversDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reqtrac-cover-'));
  const { osuApi, fetchCalls } = loadOsuApi(coversDir);
  try {
    await osuApi.downloadCover(7, 'https://evil.com/beatmaps/7/covers/cover.jpg');
    assert.deepEqual(fetchCalls, ['https://assets.ppy.sh/beatmaps/7/covers/cover.jpg']);
  } finally {
    await fs.promises.rm(coversDir, { recursive: true, force: true });
  }
});

test('downloadCover accepts official cover URLs and writes under the ID name', async () => {
  const coversDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reqtrac-cover-'));
  const { osuApi, fetchCalls } = loadOsuApi(coversDir);
  try {
    const result = await osuApi.downloadCover(10, 'https://assets.ppy.sh/beatmaps/10/covers/cover@2x.jpg');
    assert.deepEqual(fetchCalls, ['https://assets.ppy.sh/beatmaps/10/covers/cover@2x.jpg']);
    assert.equal(result, '/uploads/covers/10.jpg');
    assert.equal((await fs.promises.readdir(coversDir)).includes('10.jpg'), true);
  } finally {
    await fs.promises.rm(coversDir, { recursive: true, force: true });
  }
});

test('downloadCover refuses invalid beatmapset IDs without any request or write', async () => {
  const coversDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reqtrac-cover-'));
  const { osuApi, fetchCalls } = loadOsuApi(coversDir);
  try {
    for (const id of ['../escape', '..\\escape', null, undefined, -1, 0, 1.5, '10.jpg']) {
      assert.equal(await osuApi.downloadCover(id, 'https://assets.ppy.sh/beatmaps/1/covers/cover.jpg'), '/uploads/covers/default.jpg');
    }
    assert.deepEqual(fetchCalls, [], 'no network requests for invalid IDs');
    assert.deepEqual(await fs.promises.readdir(coversDir), [], 'no files written for invalid IDs');
  } finally {
    await fs.promises.rm(coversDir, { recursive: true, force: true });
  }
});
