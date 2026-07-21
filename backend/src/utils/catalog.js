const VALID_CATEGORY_VIEW_TYPES = new Set(['standard', 'guest_difficulties', 'tagged']);
const VALID_GAMEMODES = new Set(['osu', 'taiko', 'fruits', 'mania']);
const VALID_CATEGORY_STATUSES = new Set(['Pending', 'Working', 'Completed', 'Cancelled']);

function cleanCatalogName(value, label = 'Name') {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error(`${label} is required.`);
  if (name.length > 80) throw new Error(`${label} must be 80 characters or fewer.`);
  return name;
}

async function resolveCategory(db, input, { activeOnly = true } = {}) {
  const categoryId = Number(input?.category_id ?? input?.id);
  const name = String(input?.category_name ?? input?.name ?? input ?? '').trim();
  let category = null;

  if (Number.isSafeInteger(categoryId) && categoryId > 0) {
    category = await db.get('SELECT * FROM categories WHERE id = ?', categoryId);
  } else if (name) {
    category = await db.get('SELECT * FROM categories WHERE name = ? COLLATE NOCASE', name);
  }

  if (!category || (activeOnly && !category.is_active)) {
    const error = new Error(`Unknown or inactive request category: ${name || categoryId || 'unspecified'}`);
    error.status = 400;
    throw error;
  }
  return category;
}

async function normalizeCategories(db, categories, { activeOnly = true } = {}) {
  if (!Array.isArray(categories)) return [];
  const normalized = [];
  const seen = new Set();
  for (const input of categories) {
    const category = await resolveCategory(db, input, { activeOnly });
    if (seen.has(category.id)) continue;
    seen.add(category.id);
    normalized.push({
      ...category,
      status: VALID_CATEGORY_STATUSES.has(input?.status) ? input.status : 'Pending',
      other_text: input?.other_text || null,
    });
  }
  return normalized;
}

function normalizeGuestDifficulties(value, legacy = {}) {
  let rows = Array.isArray(value) ? value : [];
  if (rows.length === 0 && (legacy.guest_difficulty_name || legacy.guest_difficulty_target_sr)) {
    rows = [{
      difficulty_name: legacy.guest_difficulty_name,
      target_sr: legacy.guest_difficulty_target_sr,
      gamemode: 'osu',
    }];
  }

  const seenBeatmapIds = new Set();
  const normalized = [];
  for (const row of rows.slice(0, 100)) {
    const beatmapId = Number(row?.beatmap_id);
    const targetSr = row?.target_sr === '' || row?.target_sr == null ? null : Number(row.target_sr);
    const gamemode = VALID_GAMEMODES.has(row?.gamemode) ? row.gamemode : 'osu';
    const difficultyName = String(row?.difficulty_name || '').trim().slice(0, 160) || null;
    const normalizedRow = {
      beatmap_id: Number.isSafeInteger(beatmapId) && beatmapId > 0 ? beatmapId : null,
      difficulty_name: difficultyName,
      gamemode,
      target_sr: Number.isFinite(targetSr) && targetSr >= 0 ? targetSr : null,
      sort_order: normalized.length,
    };
    if (!normalizedRow.beatmap_id && !normalizedRow.difficulty_name && normalizedRow.target_sr == null) continue;
    if (normalizedRow.beatmap_id) {
      if (seenBeatmapIds.has(normalizedRow.beatmap_id)) continue;
      seenBeatmapIds.add(normalizedRow.beatmap_id);
    }
    normalized.push(normalizedRow);
  }
  return normalized;
}

async function replaceGuestDifficulties(db, requestId, rows) {
  await db.run('DELETE FROM request_guest_difficulties WHERE request_id = ?', requestId);
  for (const row of rows) {
    await db.run(`
      INSERT INTO request_guest_difficulties (
        request_id, beatmap_id, difficulty_name, gamemode, target_sr, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, requestId, row.beatmap_id, row.difficulty_name, row.gamemode, row.target_sr, row.sort_order);
  }

  const first = rows[0] || null;
  await db.run(`
    UPDATE requests
    SET guest_difficulty_name = ?, guest_difficulty_target_sr = ?, last_updated = CURRENT_TIMESTAMP
    WHERE id = ?
  `, first?.difficulty_name || null, first?.target_sr ?? null, requestId);
}

async function ensureTag(db, rawName) {
  const name = cleanCatalogName(rawName, 'Tag');
  await db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', name);
  return db.get('SELECT id, name FROM tags WHERE name = ? COLLATE NOCASE', name);
}

module.exports = {
  VALID_CATEGORY_VIEW_TYPES,
  VALID_GAMEMODES,
  cleanCatalogName,
  ensureTag,
  normalizeCategories,
  normalizeGuestDifficulties,
  replaceGuestDifficulties,
  resolveCategory,
};
