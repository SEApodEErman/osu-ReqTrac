const { normalizeGamemode } = require('./requestUtils');

function parseDifficulties(metadata) {
  if (Array.isArray(metadata?.difficulties)) return metadata.difficulties;
  if (typeof metadata?.difficulties_json === 'string') {
    try {
      return JSON.parse(metadata.difficulties_json);
    } catch {
      return [];
    }
  }
  return [];
}

function sameDifficultyName(left, right) {
  return normalizeGamemode(left?.gamemode ?? left?.mode) === normalizeGamemode(right?.mode)
    && String(left?.difficulty_name ?? left?.name ?? '').trim().toLowerCase()
      === String(right?.name ?? right?.difficulty_name ?? '').trim().toLowerCase();
}

async function reconcileGuestDifficultyAssignments(db, requestId, metadata, { matchByName = false } = {}) {
  const difficulties = parseDifficulties(metadata);
  const rows = await db.all(
    'SELECT * FROM request_guest_difficulties WHERE request_id = ? AND beatmap_id IS NOT NULL',
    requestId
  );
  let refreshed = 0;
  let preservedAsManual = 0;

  for (const row of rows) {
    const current = difficulties.find(difficulty => Number(difficulty.id) === Number(row.beatmap_id))
      || (matchByName ? difficulties.find(difficulty => sameDifficultyName(row, difficulty)) : null);
    if (current) {
      await db.run(`
        UPDATE request_guest_difficulties
        SET beatmap_id = ?, difficulty_name = ?, gamemode = ?, target_sr = ?
        WHERE id = ?
      `, [
        current.id,
        current.name || row.difficulty_name,
        normalizeGamemode(current.mode),
        Number.isFinite(Number(current.stars)) ? Number(current.stars) : row.target_sr,
        row.id,
      ]);
      refreshed += 1;
    } else {
      // Do not silently discard a user's assignment when a beatmap is deleted.
      await db.run('UPDATE request_guest_difficulties SET beatmap_id = NULL WHERE id = ?', row.id);
      preservedAsManual += 1;
    }
  }

  return { refreshed, preservedAsManual };
}

module.exports = { reconcileGuestDifficultyAssignments };
