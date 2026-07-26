const test = require('node:test');
const assert = require('node:assert/strict');

const { testUtils } = require('../src/routes/migration');

test('migration route accepts valid JSON and safely falls back for invalid JSON', () => {
  assert.deepEqual(testUtils.readJson('{"categories":["Hitsounds"]}', {}), { categories: ['Hitsounds'] });
  assert.deepEqual(testUtils.readJson('{not-json', { fallback: true }), { fallback: true });
});

test('migration route validates worksheets and resolves configured categories', () => {
  const worksheets = [
    { name: 'Empty', headers: ['Column 1', 'Column 2'] },
    { name: 'Requests', headers: ['Artist', 'Title'] },
  ];
  assert.equal(testUtils.spreadsheetForName(worksheets, 'Requests'), worksheets[1]);
  assert.throws(() => testUtils.spreadsheetForName(worksheets, 'Empty'), /header row/);
  assert.deepEqual(testUtils.importableCategories(['hitsounds', 'HITSOUNDS', 'unknown'], ['Hitsounds', 'Guest Difficulties']), ['Hitsounds']);
  assert.deepEqual(testUtils.importableCategories([], ['Hitsounds', 'Guest Difficulties']), ['Hitsounds']);
});
