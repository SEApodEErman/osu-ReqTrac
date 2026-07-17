const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findUserDifficulty,
  isGuestDifficulty,
  parseOsuLink,
  parseOsuUserLink,
} = require('../src/utils/requestUtils');

test('parses beatmapset links', () => {
  assert.deepEqual(
    parseOsuLink('https://osu.ppy.sh/beatmapsets/12345#osu/67890'),
    { type: 'beatmapset', id: 12345 }
  );
});

test('parses full and short beatmap links', () => {
  assert.deepEqual(parseOsuLink('https://osu.ppy.sh/beatmaps/12345'), { type: 'beatmap', id: 12345 });
  assert.deepEqual(parseOsuLink('https://osu.ppy.sh/b/67890'), { type: 'beatmap', id: 67890 });
});

test('rejects non-osu beatmap links', () => {
  assert.equal(parseOsuLink('https://example.com/beatmapsets/12345'), null);
  assert.equal(parseOsuLink(), null);
});

test('parses osu! user profile links', () => {
  assert.equal(parseOsuUserLink('https://osu.ppy.sh/users/12345'), 12345);
  assert.equal(parseOsuUserLink('https://osu.ppy.sh/u/67890'), 67890);
  assert.equal(parseOsuUserLink('https://osu.ppy.sh/users/mapper-name'), null);
});

test('matches a guest difficulty by the connected account id first', () => {
  const difficulties = [
    { name: 'Host', creator_id: 1, creator_name: 'Host', stars: 4.2 },
    { name: 'My GD', creator_id: 42, creator_name: 'Mapper', stars: 6.8 },
  ];

  assert.deepEqual(findUserDifficulty(difficulties, { connectedUserId: 42 }), difficulties[1]);
});

test('matches a guest difficulty by username or assigned name when an id is unavailable', () => {
  const difficulties = [
    { name: 'Guest Insane', creator_id: 4, creator_name: 'GuestMapper', stars: 5.7 },
  ];

  assert.deepEqual(findUserDifficulty(difficulties, { connectedUsername: 'guestmapper' }), difficulties[0]);
  assert.deepEqual(findUserDifficulty(difficulties, { assignedName: 'guest insane' }), difficulties[0]);
});

test('matches a difficulty by any assigned creator', () => {
  const difficulty = {
    name: 'Collab Insane',
    creator_id: 4,
    creator_ids: [4, 42],
    creator_name: 'GuestMapper',
    creator_names: ['GuestMapper', 'SecondMapper'],
    stars: 5.7,
  };

  assert.equal(findUserDifficulty([difficulty], { connectedUserId: 42 }), difficulty);
  assert.equal(findUserDifficulty([difficulty], { connectedUsername: 'secondmapper' }), difficulty);
});

test('counts a difficulty as guest-owned when a secondary creator is not the set creator', () => {
  assert.equal(isGuestDifficulty({ creator_id: 1, creator_ids: [1, 42] }, 1), true);
  assert.equal(isGuestDifficulty({ creator_id: 1, creator_ids: [1] }, 1), false);
  assert.equal(isGuestDifficulty({ creator_id: 42 }, 1), true);
});

test('returns null when no guest difficulty belongs to the connected account', () => {
  assert.equal(
    findUserDifficulty([{ name: 'Host', creator_id: 1, creator_name: 'Host', stars: 4.2 }], { connectedUserId: 42 }),
    null
  );
  assert.equal(findUserDifficulty(null, { connectedUserId: 42 }), null);
});
