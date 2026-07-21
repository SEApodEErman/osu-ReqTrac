import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COLUMN_ORDER, moveColumn, normalizeColumnOrder, requestColumnClassName } from '../src/utils/requestColumns.js';

test('column order keeps valid saved entries and fills new columns in their default order', () => {
  assert.deepEqual(normalizeColumnOrder(['priority', 'unknown', 'cover', 'priority']).slice(0, 3), ['priority', 'cover', 'song']);
  assert.deepEqual(normalizeColumnOrder(null), DEFAULT_COLUMN_ORDER);
});

test('column drag operation moves a column before its drop target without losing columns', () => {
  const reordered = moveColumn(DEFAULT_COLUMN_ORDER, 'priority', 'cover');
  assert.equal(reordered[0], 'priority');
  assert.deepEqual([...reordered].sort(), [...DEFAULT_COLUMN_ORDER].sort());
});

test('column keys map to the hyphenated class names used by table width rules', () => {
  assert.equal(requestColumnClassName('beatmap_status'), 'request-col-beatmap-status');
  assert.equal(requestColumnClassName('request_status'), 'request-col-request-status');
  assert.equal(requestColumnClassName('song'), 'request-col-song');
});
