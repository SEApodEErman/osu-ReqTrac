const fs = require('fs');
const path = require('path');
const { downloadCover } = require('../osuApi');

async function restoreCoversFromCache(db, { coversDir, download = downloadCover, concurrency = 6 } = {}) {
  const rows = await db.all('SELECT beatmapset_id, cover_url, local_cover_path FROM beatmap_cache');
  const queue = rows.filter(row => Number.isSafeInteger(row.beatmapset_id) && row.beatmapset_id > 0);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      const row = queue[index];
      if (!row) break;
      const destPath = path.join(coversDir, `${row.beatmapset_id}.jpg`);
      const targetPath = `/uploads/covers/${row.beatmapset_id}.jpg`;
      try {
        if (fs.existsSync(destPath)) {
          if (row.local_cover_path !== targetPath) {
            await db.run('UPDATE beatmap_cache SET local_cover_path = ? WHERE beatmapset_id = ?', targetPath, row.beatmapset_id);
          }
        } else {
          const result = await download(row.beatmapset_id, row.cover_url);
          if (result !== row.local_cover_path) {
            await db.run('UPDATE beatmap_cache SET local_cover_path = ? WHERE beatmapset_id = ?', result, row.beatmapset_id);
          }
        }
      } catch (error) {
        console.warn(`[cover-restore] Failed to restore cover for beatmapset ${row.beatmapset_id}:`, String(error?.message ?? error));
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
}

module.exports = { restoreCoversFromCache };