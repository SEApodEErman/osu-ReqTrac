const test = require('node:test');
const assert = require('node:assert/strict');

const { STATE_TTL_MS, consumeState, issueState } = require('../src/utils/oauthState');

test('issued state can be consumed exactly once', () => {
  const state = issueState();
  assert.match(state, /^[0-9a-f]{48}$/);
  assert.equal(consumeState(state), true);
  assert.equal(consumeState(state), false, 'state tokens must be single-use');
});

test('unknown, missing, and non-string states are rejected', () => {
  assert.equal(consumeState('never-issued'), false);
  assert.equal(consumeState(undefined), false);
  assert.equal(consumeState(null), false);
  assert.equal(consumeState(['array']), false);
});

test('expired states cannot be consumed', () => {
  const issuedAt = 1_000_000;
  const state = issueState(issuedAt);
  assert.equal(consumeState(state, issuedAt + STATE_TTL_MS), false);
  assert.equal(consumeState(state, issuedAt + 1), false, 'expired state must stay single-use');
});

test('state issued at the last valid millisecond is still accepted', () => {
  const issuedAt = 2_000_000;
  const state = issueState(issuedAt);
  assert.equal(consumeState(state, issuedAt + STATE_TTL_MS - 1), true);
});

test('expired states are pruned from memory', () => {
  const issuedAt = 3_000_000;
  const oldState = issueState(issuedAt);
  // Issuing far in the future prunes the expired entry before adding a new one.
  const freshState = issueState(issuedAt + STATE_TTL_MS + 1);
  assert.equal(consumeState(oldState, issuedAt + STATE_TTL_MS + 1), false);
  assert.equal(consumeState(freshState, issuedAt + STATE_TTL_MS + 1), true);
});
