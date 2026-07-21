function normalizeUsername(value) {
  const username = String(value || '').trim();
  return username || null;
}

// osu! user IDs are stable while usernames are intentionally mutable. Keep the
// latest display name in users_cache and retain every observed name for search.
async function recordUserIdentity(db, user) {
  const id = Number(user?.id);
  const username = normalizeUsername(user?.username);
  if (!Number.isSafeInteger(id) || id <= 0 || !username) return null;

  const avatarUrl = String(user?.avatar_url || '');
  const countryCode = String(user?.country_code || '');
  await db.run(`
    INSERT INTO users_cache (id, username, avatar_url, country_code, last_updated)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      avatar_url = CASE WHEN excluded.avatar_url = '' THEN users_cache.avatar_url ELSE excluded.avatar_url END,
      country_code = CASE WHEN excluded.country_code = '' THEN users_cache.country_code ELSE excluded.country_code END,
      last_updated = CURRENT_TIMESTAMP
  `, [id, username, avatarUrl, countryCode]);
  await db.run(`
    INSERT INTO user_username_history (user_id, username, first_seen, last_seen)
    VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, username) DO UPDATE SET last_seen = CURRENT_TIMESTAMP
  `, [id, username]);
  return { id, username, avatar_url: avatarUrl, country_code: countryCode };
}

async function recordUnavailableUser(db, userId, username = null) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const normalizedUsername = normalizeUsername(username);
  await db.run(`
    INSERT OR IGNORE INTO unavailable_osu_users (user_id, username, first_failed_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `, [id, normalizedUsername]);
  return { user_id: id, username: normalizedUsername };
}

async function getUnavailableUserIds(db) {
  const rows = await db.all('SELECT user_id FROM unavailable_osu_users');
  return new Set(rows.map(row => Number(row.user_id)));
}

function canonicalDifficultyNames(difficulty, usersById) {
  const ids = Array.isArray(difficulty?.creator_ids) && difficulty.creator_ids.length > 0
    ? difficulty.creator_ids
    : (difficulty?.creator_id ? [difficulty.creator_id] : []);
  const currentNames = ids.map(id => usersById.get(Number(id))?.username).filter(Boolean);
  const fallbackNames = Array.isArray(difficulty?.creator_names) && difficulty.creator_names.length > 0
    ? difficulty.creator_names.filter(Boolean)
    : (difficulty?.creator_name ? [difficulty.creator_name] : []);
  const creatorNames = currentNames.length > 0 ? currentNames : fallbackNames;
  return { ...difficulty, creator_name: creatorNames[0] || difficulty?.creator_name, creator_names: creatorNames };
}

module.exports = {
  canonicalDifficultyNames,
  getUnavailableUserIds,
  normalizeUsername,
  recordUnavailableUser,
  recordUserIdentity,
};
