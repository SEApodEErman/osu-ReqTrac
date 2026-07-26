const test = require('node:test');
const assert = require('node:assert/strict');

const { testUtils } = require('../src/routes/googleSheets');

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
