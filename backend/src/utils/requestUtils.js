function parseOsuLink(link) {
  if (!link) return null;

  const beatmapsetMatch = link.match(/osu\.ppy\.sh\/beatmapsets\/(\d+)/i);
  if (beatmapsetMatch) {
    return { type: 'beatmapset', id: Number.parseInt(beatmapsetMatch[1], 10) };
  }

  const beatmapMatch = link.match(/osu\.ppy\.sh\/(?:beatmaps|b)\/(\d+)/i);
  if (beatmapMatch) {
    return { type: 'beatmap', id: Number.parseInt(beatmapMatch[1], 10) };
  }

  return null;
}

function parseOsuUserLink(link) {
  if (!link) return null;
  const match = link.match(/osu\.ppy\.sh\/(?:users|u)\/(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function findUserDifficulty(difficulties, { connectedUserId, connectedUsername, assignedName } = {}) {
  if (!Array.isArray(difficulties)) return null;

  const normalizedUsername = connectedUsername?.toLowerCase();
  const normalizedAssignedName = assignedName?.toLowerCase();

  return difficulties.find((difficulty) =>
    (connectedUserId && (
      difficulty.creator_id === connectedUserId ||
      difficulty.creator_ids?.includes(connectedUserId)
    )) ||
    (normalizedUsername && (
      difficulty.creator_name?.toLowerCase() === normalizedUsername ||
      difficulty.creator_names?.some(name => name?.toLowerCase() === normalizedUsername)
    )) ||
    (normalizedAssignedName && difficulty.name?.toLowerCase() === normalizedAssignedName)
  ) || null;
}

function normalizeGamemode(mode) {
  if (mode === 1 || mode === '1' || mode === 'taiko') return 'taiko';
  if (mode === 2 || mode === '2' || mode === 'fruits' || mode === 'catch') return 'fruits';
  if (mode === 3 || mode === '3' || mode === 'mania') return 'mania';
  return 'osu';
}

function findUserDifficulties(difficulties, {
  connectedUserId,
  connectedUsername,
  assignments = [],
} = {}) {
  if (!Array.isArray(difficulties)) return [];
  const username = connectedUsername?.toLowerCase();
  const assignmentList = Array.isArray(assignments) ? assignments : [];
  const matches = difficulties.filter(difficulty => {
    const creatorMatch = Boolean(
      (connectedUserId && (
        difficulty.creator_id === connectedUserId || difficulty.creator_ids?.includes(connectedUserId)
      )) ||
      (username && (
        difficulty.creator_name?.toLowerCase() === username ||
        difficulty.creator_names?.some(name => name?.toLowerCase() === username)
      ))
    );
    const assignmentMatch = assignmentList.some(assignment => {
      if (assignment.beatmap_id && Number(assignment.beatmap_id) === Number(difficulty.id)) return true;
      const assignedName = assignment.difficulty_name?.toLowerCase();
      return assignedName && assignedName === difficulty.name?.toLowerCase()
        && normalizeGamemode(assignment.gamemode) === normalizeGamemode(difficulty.mode);
    });
    return creatorMatch || assignmentMatch;
  });

  const seen = new Set();
  return matches.filter(difficulty => {
    const key = difficulty.id || `${normalizeGamemode(difficulty.mode)}:${difficulty.name?.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isGuestDifficulty(difficulty, beatmapsetCreatorId) {
  if (!difficulty?.creator_id || !beatmapsetCreatorId) return false;

  const creatorIds = Array.isArray(difficulty.creator_ids) && difficulty.creator_ids.length > 0
    ? difficulty.creator_ids
    : [difficulty.creator_id];

  return creatorIds.some(creatorId => creatorId !== beatmapsetCreatorId);
}

module.exports = {
  findUserDifficulty,
  findUserDifficulties,
  isGuestDifficulty,
  normalizeGamemode,
  parseOsuLink,
  parseOsuUserLink,
};
