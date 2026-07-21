export function normalizeGamemode(mode) {
  if (mode === 1 || mode === '1' || mode === 'taiko') return 'taiko';
  if (mode === 2 || mode === '2' || mode === 'fruits' || mode === 'catch') return 'fruits';
  if (mode === 3 || mode === '3' || mode === 'mania') return 'mania';
  return 'osu';
}

export function createManualGuestDifficulty() {
  return { gamemode: 'osu', difficulty_name: '', target_sr: '' };
}

export function toUploadedGuestDifficulty(difficulty) {
  return {
    beatmap_id: Number(difficulty.id),
    difficulty_name: difficulty.name || difficulty.version || '',
    gamemode: normalizeGamemode(difficulty.mode),
    target_sr: Number.isFinite(Number(difficulty.stars ?? difficulty.difficulty_rating))
      ? Number(difficulty.stars ?? difficulty.difficulty_rating)
      : '',
  };
}

export function isUploadedGuestDifficulty(row) {
  return Number.isSafeInteger(Number(row?.beatmap_id)) && Number(row.beatmap_id) > 0;
}

export function isDifficultySelected(rows, difficultyId) {
  return (rows || []).some(row => Number(row.beatmap_id) === Number(difficultyId));
}

export function addUploadedGuestDifficulty(rows, difficulty) {
  if (isDifficultySelected(rows, difficulty.id)) return rows;
  return [...rows, toUploadedGuestDifficulty(difficulty)];
}

export function findConnectedUserDifficulties(difficulties, connectedAccount) {
  const userId = Number(connectedAccount?.id);
  const username = connectedAccount?.username?.toLowerCase();
  if (!Array.isArray(difficulties) || (!Number.isSafeInteger(userId) && !username)) return [];

  return difficulties.filter(difficulty => {
    const creatorIds = Array.isArray(difficulty.creator_ids)
      ? difficulty.creator_ids.map(Number)
      : [Number(difficulty.creator_id)];
    const creatorNames = Array.isArray(difficulty.creator_names)
      ? difficulty.creator_names
      : [difficulty.creator_name];
    return (Number.isSafeInteger(userId) && creatorIds.includes(userId))
      || Boolean(username && creatorNames.some(name => name?.toLowerCase() === username));
  });
}
