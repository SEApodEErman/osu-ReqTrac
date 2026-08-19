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

test('migration route parses raw backup buffers and strips oversized legacy covers', () => {
  const bigLegacy = {
    version: '4.0.0',
    cover_files: [{ filename: '1.jpg', data: 'A'.repeat(51 * 1024 * 1024) }]
  };
  const parsed = testUtils.prepareBackupFromBody(Buffer.from(JSON.stringify(bigLegacy)));
  assert.equal(parsed.version, '4.0.0');
  assert.equal(parsed.cover_files, undefined);
});

test('migration route keeps small legacy cover data and passes object bodies through', () => {
  const smallLegacy = { version: '4.0.0', cover_files: [{ filename: '1.jpg', data: 'data' }] };
  assert.equal(testUtils.prepareBackupFromBody(Buffer.from(JSON.stringify(smallLegacy))).cover_files.length, 1);
  const objectBody = { version: '5.0.0' };
  assert.equal(testUtils.prepareBackupFromBody(objectBody), objectBody);
});

test('migration route throws on malformed raw JSON', () => {
  assert.throws(() => testUtils.prepareBackupFromBody(Buffer.from('{not-json')), SyntaxError);
});
