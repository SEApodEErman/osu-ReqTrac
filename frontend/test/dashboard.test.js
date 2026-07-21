import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRecentDashboardRequests,
  requestBelongsToDashboardCategory,
} from '../src/utils/dashboard.js';

const requests = [
  { id: 1, added_date: '2026-07-19', categories: [{ category_id: 1 }, { category_id: 2 }] },
  { id: 2, added_date: '2026-07-21', categories: [{ category_id: 1 }] },
  { id: 3, added_date: '2026-07-20', categories: [{ category_id: 2 }] },
];

test('dashboard category matching uses stable IDs and supports multi-category requests', () => {
  assert.equal(requestBelongsToDashboardCategory(requests[0], '1'), true);
  assert.equal(requestBelongsToDashboardCategory(requests[0], '2'), true);
  assert.equal(requestBelongsToDashboardCategory(requests[1], '2'), false);
  assert.equal(requestBelongsToDashboardCategory(requests[1], 'invalid'), false);
  assert.equal(requestBelongsToDashboardCategory(requests[1], 'all'), true);
});

test('recent dashboard requests are scoped before sorting and limiting', () => {
  assert.deepEqual(getRecentDashboardRequests(requests, 'all', 2).map(request => request.id), [2, 3]);
  assert.deepEqual(getRecentDashboardRequests(requests, '1').map(request => request.id), [2, 1]);
  assert.deepEqual(getRecentDashboardRequests(requests, '2').map(request => request.id), [3, 1]);
  assert.deepEqual(getRecentDashboardRequests(requests, '999'), []);
});
