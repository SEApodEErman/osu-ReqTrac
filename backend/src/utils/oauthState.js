// One-time CSRF state tokens for the osu! OAuth authorization flow.
//
// The authorization-code callback is a bare GET endpoint on a loopback
// server; without a state parameter any site or local process that can steer
// a browser to the callback can complete an OAuth handshake for its own osu!
// account and have it recorded as the connected account (login CSRF).
// Tokens are single-use, expire after ten minutes, and are held in memory
// only — the flow never outlives the app process.

const crypto = require('crypto');

const STATE_TTL_MS = 10 * 60 * 1000;
const pendingStates = new Map();

function pruneExpiredStates(now) {
  for (const [state, expiresAt] of pendingStates) {
    if (expiresAt <= now) pendingStates.delete(state);
  }
}

function issueState(now = Date.now()) {
  pruneExpiredStates(now);
  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, now + STATE_TTL_MS);
  return state;
}

// Single-use: the entry is removed whether or not it was expired.
function consumeState(state, now = Date.now()) {
  pruneExpiredStates(now);
  if (typeof state !== 'string' || !pendingStates.has(state)) return false;
  const expiresAt = pendingStates.get(state);
  pendingStates.delete(state);
  return expiresAt > now;
}

module.exports = { STATE_TTL_MS, consumeState, issueState };
