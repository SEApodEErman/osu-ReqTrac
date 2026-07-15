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
    (connectedUserId && difficulty.creator_id === connectedUserId) ||
    (normalizedUsername && difficulty.creator_name?.toLowerCase() === normalizedUsername) ||
    (normalizedAssignedName && difficulty.name?.toLowerCase() === normalizedAssignedName)
  ) || null;
}

module.exports = {
  findUserDifficulty,
  parseOsuLink,
  parseOsuUserLink,
};
