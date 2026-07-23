const { parseOsuLink } = require('./requestUtils');
const { reconcileGuestDifficultyAssignments } = require('./guestDifficultyAssignments');

function requestError(message, status, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

async function resolveBeatmapsetId(link, fetchBeatmap) {
  const rawLink = String(link || '').trim();
  if (/^\d+$/.test(rawLink)) {
    const numericId = Number(rawLink);
    if (Number.isSafeInteger(numericId) && numericId > 0) return numericId;
  }
  const parsedLink = parseOsuLink(rawLink);
  if (!parsedLink) throw requestError('Provide a valid osu! beatmap or beatmapset link.', 400);
  if (parsedLink.type === 'beatmapset') return parsedLink.id;
  const beatmap = await fetchBeatmap(parsedLink.id);
  if (!Number.isSafeInteger(Number(beatmap?.beatmapset_id))) {
    throw requestError('Could not resolve the beatmapset from that link.', 400);
  }
  return Number(beatmap.beatmapset_id);
}

async function replaceRequestBeatmapset({ db, requestId, link, fetchBeatmap, refreshBeatmapset }) {
  const numericRequestId = Number(requestId);
  if (!Number.isSafeInteger(numericRequestId) || numericRequestId <= 0) {
    throw requestError('Invalid request ID.', 400);
  }
  const request = await db.get('SELECT id, beatmapset_id, is_osu_link FROM requests WHERE id = ?', numericRequestId);
  if (!request) throw requestError('Request not found.', 404);
  if (!request.is_osu_link || !request.beatmapset_id) {
    throw requestError('Only osu!-linked requests can change mapsets.', 400);
  }

  const beatmapsetId = await resolveBeatmapsetId(link, fetchBeatmap);
  if (beatmapsetId === Number(request.beatmapset_id)) {
    throw requestError('This request is already linked to that beatmapset.', 409);
  }
  const duplicate = await db.get('SELECT id FROM requests WHERE beatmapset_id = ? AND id <> ?', beatmapsetId, numericRequestId);
  if (duplicate) throw requestError('That beatmapset is already linked to another request.', 409, { requestId: duplicate.id });

  // Validate and cache the replacement before touching the existing request.
  const metadata = await refreshBeatmapset(db, beatmapsetId);
  await db.exec('BEGIN TRANSACTION');
  try {
    await db.run('UPDATE requests SET beatmapset_id = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?', beatmapsetId, numericRequestId);
    const guestResult = await reconcileGuestDifficultyAssignments(db, numericRequestId, metadata, { matchByName: true });
    await db.run(
      'INSERT INTO history (request_id, action_type, details) VALUES (?, ?, ?)',
      [numericRequestId, 'beatmapset_changed', `Beatmapset changed from ${request.beatmapset_id} to ${beatmapsetId}. ${guestResult.preservedAsManual} guest difficult${guestResult.preservedAsManual === 1 ? 'y was' : 'ies were'} preserved as manual.`]
    );
    await db.exec('COMMIT');
    return { beatmapsetId, metadata, guestResult };
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => {});
    throw error;
  }
}

module.exports = { replaceRequestBeatmapset, resolveBeatmapsetId };
