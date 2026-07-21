import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequestSearch, requestMatchesSearch } from '../src/utils/requestSearch.js';

const request = {
  artist: 'Artist', title: 'Song', creator: 'Mita', creator_aliases: ['-AzuMI'],
  requester_username: 'Requester', tags: ['collab'], request_status: 'Working', ranked_status: 'Ranked', priority: 'High',
  beatmapset_id: 123, added_date: '2026-01-03', categories: [{ category_name: 'Guest Difficulties' }], gamemodes: ['mania'],
  search_difficulties: [{ name: '4K Insane', mode: 'mania', stars: 5.2, cs: 4, od: 8, hp: 7, bpm: 180, drain: 120 }]
};

test('request search parses quoted osu!-style filters', () => {
  assert.deepEqual(parseRequestSearch('creator="Mahiru Shiina" stars>=5').filters, [
    { key: 'creator', operator: '=', value: 'mahiru shiina' },
    { key: 'stars', operator: '>=', value: '5' }
  ]);
});

test('request search matches current and historical creators plus mode attributes', () => {
  assert.equal(requestMatchesSearch(request, 'creator="-AzuMI" keys=4 mode=mania stars>=5'), true);
  assert.equal(requestMatchesSearch({ ...request, creator: 'ItsCactus', creator_aliases: ['Sweep Tosho'] }, 'creator="sweep tosho"'), true);
  assert.equal(requestMatchesSearch(request, 'tag=collab status=Working deadline>=2026-01-01'), false);
  assert.equal(requestMatchesSearch(request, 'priority=High 4K'), true);
});
