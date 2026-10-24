const test = require('node:test');
const assert = require('node:assert/strict');

const { testUtils } = require('../src/routes/googleSheets');

test('Google authorization requests only per-file access and keeps PKCE and one-time state', async (t) => {
  const configPath = require.resolve('../src/googleConfig');
  const routePath = require.resolve('../src/routes/googleSheets');
  const originalConfig = require.cache[configPath];
  const originalRoute = require.cache[routePath];
  let router;
  try {
    require.cache[configPath] = { id: configPath, filename: configPath, loaded: true,
      exports: { getGoogleConfig: () => ({ clientId: 'test-client', clientSecret: '' }) } };
    delete require.cache[routePath];
    router = require('../src/routes/googleSheets');
  } finally {
    require.cache[configPath] = originalConfig;
    require.cache[routePath] = originalRoute;
  }
  const app = require('express')();
  app.use('/api/google', router);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  await require('node:events').once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/google/auth-url`);
  assert.equal(response.status, 200);
  const url = new URL((await response.json()).url);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(url.searchParams.get('redirect_uri'), `${origin}/api/google/callback`);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('code_challenge'), /^[\w-]{43}$/);
  assert.match(url.searchParams.get('state'), /^[a-f0-9]{48}$/);
  const callback = new URL(`${origin}/api/google/callback`);
  callback.search = new URLSearchParams({ state: url.searchParams.get('state'), error: 'access_denied' });
  const denied = await fetch(callback);
  assert.equal(denied.status, 400);
  assert.match(await denied.text(), /access_denied/);
  const replay = await fetch(callback);
  assert.equal(replay.status, 400);
  assert.match(await replay.text(), /authorization expired/);
});

test('Google Sheets route generates safe unique sheet titles and serial dates', () => {
  const used = new Set();
  assert.equal(testUtils.safeSheetTitle('ReqTrac: Hitsounds?', used), 'ReqTrac Hitsounds');
  assert.equal(testUtils.safeSheetTitle('dashboard', used), 'dashboard (2)');
  assert.equal(testUtils.sheetDate('1899-12-30'), 0);
  assert.equal(testUtils.sheetDate('not-a-date'), '');
});

test('Google Sheets route maps category layouts and rows consistently', () => {
  const snapshot = {
    categoryDefinitions: [{ name: 'Guest Difficulties', system_key: 'guest_difficulties' }],
    requests: [{
      categories: ['Guest Difficulties'], artist: 'Artist', title: 'Title', creator: 'Creator', numDifficulties: 2,
      guestStars: 6.5, gamemodes: ['osu', 'mania'], mapStatus: 'Ranked', status: 'Working', priority: 'High',
      deadline: '2026-07-27', addedDate: '2026-07-01', completedDate: null, notes: 'Note', osuUrl: 'https://osu.ppy.sh',
    }],
  };
  const [model] = testUtils.categorySheetModels(snapshot);
  assert.deepEqual(model.layout, { metricHeader: 'GD Stars / Gamemodes', metricKey: 'guestStars', includeModes: true });
  const [, row] = testUtils.categoryRows(snapshot, model);
  assert.equal(row[4], '6.50 · osu, mania');
  assert.equal(testUtils.starDifficultyColor(10), '#000000');
});

test('Google Sheets formatting requests do not clear written values', () => {
  const categoryRequests = testUtils.categoryFormatting(
    { properties: { sheetId: 1 }, bandedRanges: [], conditionalFormats: [] },
    2,
    'light',
    [['Artist'], ['Title']],
    { metricKey: 'tags' }
  );
  const dashboardRequests = testUtils.dashboardFormatting(2, 16, {
    overviewHeader: 3,
    statsHeader: 7,
    yearlySection: 11,
    yearlyHeader: 12,
    requesterSection: 14,
    requesterHeader: 15
  }, 'light');

  for (const request of [...categoryRequests, ...dashboardRequests]) {
    assert.equal(request.updateCells, undefined);
  }
});
