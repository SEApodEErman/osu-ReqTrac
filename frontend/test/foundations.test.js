import test from 'node:test';
import assert from 'node:assert/strict';
import { compareAppDates, daysUntil, describeDeadline, parseAppDate, toDateInputValue } from '../src/utils/dates.js';
import { buildAttentionGroups, requestMatchesQuickFilters } from '../src/utils/attention.js';
import { requestsToCsv } from '../src/utils/csv.js';
import { beatmapIdFromLink, beatmapsetIdFromLink, extractOsuBeatmapLink, extractOsuBeatmapLinks, isOsuBeatmapLink } from '../src/utils/osuLinks.js';
import { requestMatchesSearch } from '../src/utils/requestSearch.js';
import { starRatingColor, starRatingTextColor } from '../src/utils/starRating.js';

test('calendar dates stay on their local day while timestamps keep their zone', () => {
  const deadline = parseAppDate('2026-10-17');
  assert.deepEqual([deadline.getFullYear(), deadline.getMonth(), deadline.getDate()], [2026, 9, 17]);
  assert.equal(parseAppDate('2026-07-15 09:40:03').toISOString(), '2026-07-15T09:40:03.000Z');
  assert.equal(parseAppDate('2022-06-12T04:14:26Z').toISOString(), '2022-06-12T04:14:26.000Z');
  assert.equal(parseAppDate(''), null);
  assert.equal(parseAppDate('not a date'), null);
  assert.equal(toDateInputValue('2026-10-17'), '2026-10-17');
  assert.equal(toDateInputValue(null), '');
});

test('deadline wording counts calendar days from today', () => {
  const now = new Date(2026, 9, 17, 23, 30);
  assert.equal(daysUntil('2026-10-18', now), 1);
  assert.deepEqual(describeDeadline('2026-10-17', 'Working', now), { tone: 'overdue', days: 0, text: 'Due today' });
  assert.equal(describeDeadline('2026-10-14', 'Accepted', now).text, '3d overdue');
  assert.equal(describeDeadline('2026-10-20', 'Accepted', now).tone, 'urgent');
  assert.equal(describeDeadline('2026-10-14', 'Completed', now).tone, 'muted');
  assert.equal(describeDeadline(null, 'Working', now), null);
});

test('date comparison sorts missing dates last', () => {
  const values = ['2026-02-01', null, '2025-12-31T10:00:00Z', ''];
  assert.deepEqual(values.sort(compareAppDates), ['2025-12-31T10:00:00Z', '2026-02-01', null, '']);
});

test('search date filters compare whole calendar days', () => {
  const request = { added_date: '2026-01-03T22:00:00Z', deadline: '2026-01-05', categories: [], tags: [] };
  const local = parseAppDate(request.added_date);
  const day = toDateInputValue(local);
  assert.equal(requestMatchesSearch(request, `added=${day}`), true);
  assert.equal(requestMatchesSearch(request, 'deadline<=2026-01-05'), true);
  assert.equal(requestMatchesSearch(request, 'deadline<2026-01-05'), false);
});

test('osu! links are recognised in pasted and copied text', () => {
  assert.equal(isOsuBeatmapLink('https://osu.ppy.sh/beatmapsets/123#osu/456'), true);
  assert.equal(isOsuBeatmapLink('https://osu.ppy.sh/users/2'), false);
  assert.equal(extractOsuBeatmapLink('check this (osu.ppy.sh/b/789).'), 'https://osu.ppy.sh/b/789');
  assert.deepEqual(extractOsuBeatmapLinks('https://osu.ppy.sh/s/1\nhttps://osu.ppy.sh/s/1 https://osu.ppy.sh/beatmaps/2'), ['https://osu.ppy.sh/s/1', 'https://osu.ppy.sh/beatmaps/2']);
  assert.equal(beatmapsetIdFromLink('https://osu.ppy.sh/beatmapsets/123#mania/456'), 123);
  assert.equal(beatmapIdFromLink('https://osu.ppy.sh/beatmapsets/123#mania/456'), 456);
  assert.equal(beatmapIdFromLink('https://osu.ppy.sh/b/789'), 789);
});

test('attention groups surface overdue, upcoming, undecided, and failed work', () => {
  const now = new Date(2026, 9, 17, 12);
  const requests = [
    { id: 1, request_status: 'Working', deadline: '2026-10-16', priority: 'Low' },
    { id: 2, request_status: 'Accepted', deadline: '2026-10-20', priority: 'High' },
    { id: 3, request_status: 'Considering', deadline: null, priority: 'Low' },
    { id: 4, request_status: 'Completed', deadline: '2026-10-01', priority: 'High', metadata_sync_status: 'Failed' },
    { id: 5, request_status: 'Working', deadline: '2026-12-01', priority: 'High' },
  ];
  const groups = Object.fromEntries(buildAttentionGroups(requests, now).map(group => [group.key, group.requests.map(request => request.id)]));
  assert.deepEqual(groups, { overdue: [1], 'due-soon': [2], 'high-priority': [2], undecided: [3], 'sync-failed': [4] });
  assert.equal(requestMatchesQuickFilters(requests[0], { due: 'overdue' }, now), true);
  assert.equal(requestMatchesQuickFilters(requests[3], { due: 'overdue' }, now), false);
  assert.equal(requestMatchesQuickFilters(requests[1], { priority: 'High', status: 'not-working' }, now), true);
  assert.equal(requestMatchesQuickFilters(requests[4], { status: 'not-working' }, now), false);
  assert.equal(requestMatchesQuickFilters(requests[3], { status: 'active' }, now), false);
});

test('CSV export quotes text and neutralises spreadsheet formulas', () => {
  const csv = requestsToCsv([{ artist: 'A, B', title: '=HYPERLINK("x")', notes: 'line\nbreak', categories: [{ category_name: 'Hitsounds' }], tags: ['collab'], is_osu_link: 1, ranked_status: 'Ranked', beatmapset_id: 5 }]);
  const [header, row] = csv.split('\r\n');
  assert.match(header, /^Artist,Title,Mapper/);
  assert.match(row, /^"A, B","'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /"line\nbreak"/);
  assert.match(row, /https:\/\/osu\.ppy\.sh\/beatmapsets\/5$/);
});

test('star colours follow the osu! spectrum', () => {
  assert.equal(starRatingColor(0), '#aaaaaa');
  assert.equal(starRatingColor(2), '#4fffd5');
  assert.equal(starRatingColor(12), '#000000');
  assert.equal(starRatingTextColor(3), 'rgba(0, 0, 0, 0.78)');
  assert.equal(starRatingTextColor(7), '#f6f05c');
});

test('calendar dates are shown without an invented time of day', async () => {
  const { formatDateTime } = await import('../src/utils/dates.js');
  assert.doesNotMatch(formatDateTime('2026-07-14'), /:/);
  assert.match(formatDateTime('2026-07-14 09:40:03'), /:/);
});
