const test = require('node:test');
const assert = require('node:assert/strict');

const { testUtils } = require('../src/routes/requests');

test('requests route normalizes bulk request IDs and lifecycle dates', () => {
  assert.deepEqual(testUtils.normalizedRequestIds([1, '2', 2, 0, -1, 'nope', 1.5]), [1, 2]);
  assert.equal(testUtils.formatLifecycleDate('2026-07-27T15:30:00Z'), '2026-07-27');
  assert.equal(testUtils.formatLifecycleDate('invalid'), null);
});

test('requests route prefers ranked dates for ranked and loved beatmaps', () => {
  assert.equal(testUtils.getEffectiveBeatmapDate({ ranked_status: 'Ranked', ranked_date: '2026-01-02', osu_last_updated: '2026-03-04' }), '2026-01-02');
  assert.equal(testUtils.getEffectiveBeatmapDate({ ranked_status: 'Pending', ranked_date: '2026-01-02', osu_last_updated: '2026-03-04' }), '2026-03-04');
  assert.equal(testUtils.getEffectiveBeatmapDate({ submitted_date: '2025-01-02' }), '2025-01-02');
});

test('requests route returns a complete date-refresh job response', () => {
  const result = testUtils.createRefreshDateResult([{ id: 1 }]);
  assert.deepEqual(testUtils.refreshDateJobResponse({ id: 'job-1', status: 'completed', total: 2, processed: 2, result }), {
    jobId: 'job-1', status: 'completed', total: 2, processed: 2, result,
  });
});
