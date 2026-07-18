const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRows,
  parseWorkbook,
  suggestMapping,
  validateMapping
} = require('../src/utils/spreadsheetImport');

test('suggests exported Google Sheet headers and ignores unrelated columns', () => {
  const mapping = suggestMapping(['Artist', 'Title', 'Notes', 'osu! Link', 'Year', 'Internal owner']);

  assert.deepEqual(mapping, {
    Artist: 'artist',
    Title: 'title',
    Notes: 'notes',
    'osu! Link': 'link',
    Year: 'addedDate',
    'Internal owner': 'ignore'
  });
});

test('normalizes a four-digit year as January 1 of that year', () => {
  const { records } = normalizeRows(['Title', 'Year'], [['Manual request', '2026']], {
    Title: 'title',
    Year: 'addedDate'
  });

  assert.equal(records[0].addedDate, '2026-01-01');
  assert.deepEqual(records[0].errors, []);
});

test('rejects mapping multiple source columns to one request field', () => {
  const result = validateMapping(['Remarks', 'Comments'], { Remarks: 'notes', Comments: 'notes' });

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Multiple columns/);
});

test('normalizes spreadsheet rows, preserves remarks, and ignores selected columns', () => {
  const headers = ['Beatmap URL', 'Remarks', 'Unused', 'Status', 'Priority', 'Category'];
  const { records, errors } = normalizeRows(headers, [[
    'https://osu.ppy.sh/beatmapsets/123', 'Keep the storyboard timing', 'do not import', 'working', 'high', 'Storyboards'
  ]], {
    'Beatmap URL': 'link',
    Remarks: 'notes',
    Unused: 'ignore',
    Status: 'status',
    Priority: 'priority',
    Category: 'category'
  });

  assert.deepEqual(errors, []);
  assert.equal(records[0].notes, 'Keep the storyboard timing');
  assert.equal(records[0].status, 'Working');
  assert.equal(records[0].priority, 'High');
  assert.deepEqual(records[0].categories, ['Storyboards']);
  assert.equal(records[0].Unused, undefined);
  assert.deepEqual(records[0].errors, []);
});

test('validates invalid source values without rejecting valid neighboring rows', () => {
  const headers = ['Title', 'Status', 'Deadline', 'Category'];
  const { records } = normalizeRows(headers, [
    ['Manual request', 'Accepted', '2026-08-01', 'Hitsounds'],
    ['Bad request', 'Unknown', 'not a date', 'Unsupported']
  ], { Title: 'title', Status: 'status', Deadline: 'deadline', Category: 'category' });

  assert.deepEqual(records[0].errors, []);
  assert.equal(records[1].errors.length, 3);
});

test('reports malformed beatmap links during preview normalization', () => {
  const { records } = normalizeRows(['Beatmap Link'], [['https://example.com/beatmaps/1']], { 'Beatmap Link': 'link' });

  assert.match(records[0].errors.join(' '), /valid osu!/);
});

test('parses CSV workbooks into headers and non-empty rows', () => {
  const sheets = parseWorkbook(Buffer.from('osu! Link,Remarks\nhttps://osu.ppy.sh/beatmapsets/1,Preserve this\n,\n'));

  assert.equal(sheets.length, 1);
  assert.deepEqual(sheets[0].headers, ['osu! Link', 'Remarks']);
  assert.deepEqual(sheets[0].rows, [['https://osu.ppy.sh/beatmapsets/1', 'Preserve this']]);
});

test('makes duplicate headers distinct so one can be ignored independently', () => {
  const [sheet] = parseWorkbook(Buffer.from('Notes,Notes\nFirst,Second\n'));

  assert.deepEqual(sheet.headers, ['Notes', 'Notes (2)']);
});
