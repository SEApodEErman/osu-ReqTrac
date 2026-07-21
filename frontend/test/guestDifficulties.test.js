import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addUploadedGuestDifficulty,
  createManualGuestDifficulty,
  findConnectedUserDifficulties,
  isDifficultySelected,
} from '../src/utils/guestDifficulties.js';

const difficulties = [
  { id: 1, name: 'Host', mode: 'osu', stars: 4.2, creator_ids: [10], creator_names: ['Host'] },
  { id: 2, name: 'My 4K', mode: 'mania', stars: 6.4, creator_ids: [42], creator_names: ['Guest'] },
  { id: 3, name: 'Collab', mode: 'taiko', stars: 5.1, creator_ids: [10, 42], creator_names: ['Host', 'Guest'] },
];

test('autofill finds each uploaded difficulty owned by the connected account', () => {
  assert.deepEqual(
    findConnectedUserDifficulties(difficulties, { id: 42, username: 'Guest' }).map(item => item.id),
    [2, 3]
  );
});

test('uploaded additions preserve their beatmap id and cannot be duplicated', () => {
  const first = addUploadedGuestDifficulty([createManualGuestDifficulty()], difficulties[1]);
  const duplicate = addUploadedGuestDifficulty(first, difficulties[1]);
  assert.equal(first.length, 2);
  assert.deepEqual(duplicate, first);
  assert.equal(isDifficultySelected(first, 2), true);
  assert.deepEqual(first[1], {
    beatmap_id: 2,
    difficulty_name: 'My 4K',
    gamemode: 'mania',
    target_sr: 6.4,
  });
});
