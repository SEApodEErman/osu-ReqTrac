const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { restoreCoversFromCache } = require('../src/services/coverRestore');

test('restoreCoversFromCache downloads missing covers and updates local_cover_path', async () => {
  const coversDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reqtrac-restore-'));
  const updates = [];
  const db = {
    all: async () => [{ beatmapset_id: 10, cover_url: 'https://cdn/x/10.jpg', local_cover_path: '/uploads/covers/default.jpg' }],
    run: async (sql, ...args) => { updates.push({ sql, args }); }
  };
  const download = async () => '/uploads/covers/10.jpg';

  await restoreCoversFromCache(db, { coversDir, download });

  assert.deepEqual(updates, [{
    sql: 'UPDATE beatmap_cache SET local_cover_path = ? WHERE beatmapset_id = ?',
    args: ['/uploads/covers/10.jpg', 10]
  }]);
  await fs.promises.rm(coversDir, { recursive: true, force: true });
});

test('restoreCoversFromCache keeps existing covers without downloading', async () => {
  const coversDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reqtrac-restore-'));
  await fs.promises.writeFile(path.join(coversDir, '10.jpg'), 'cover-data');
  const updates = [];
  const db = {
    all: async () => [{ beatmapset_id: 10, cover_url: 'x', local_cover_path: '/uploads/covers/default.jpg' }],
    run: async (sql, ...args) => { updates.push({ sql, args }); }
  };
  let downloads = 0;
  const download = async () => { downloads++; throw new Error('must not be called'); };

  await restoreCoversFromCache(db, { coversDir, download });

  assert.equal(downloads, 0);
  assert.deepEqual(updates, [{
    sql: 'UPDATE beatmap_cache SET local_cover_path = ? WHERE beatmapset_id = ?',
    args: ['/uploads/covers/10.jpg', 10]
  }]);
  await fs.promises.rm(coversDir, { recursive: true, force: true });
});

test('restoreCoversFromCache records default path when a download fails', async () => {
  const coversDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reqtrac-restore-'));
  const updates = [];
  const db = {
    all: async () => [{ beatmapset_id: 10, cover_url: 'x', local_cover_path: '/uploads/covers/10.jpg' }],
    run: async (sql, ...args) => { updates.push({ sql, args }); }
  };
  const download = async () => '/uploads/covers/default.jpg';

  await restoreCoversFromCache(db, { coversDir, download });

  assert.deepEqual(updates, [{
    sql: 'UPDATE beatmap_cache SET local_cover_path = ? WHERE beatmapset_id = ?',
    args: ['/uploads/covers/default.jpg', 10]
  }]);
  await fs.promises.rm(coversDir, { recursive: true, force: true });
});

test('restoreCoversFromCache skips rows without a positive beatmapset_id', async () => {
  const coversDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reqtrac-restore-'));
  const updates = [];
  const db = {
    all: async () => [{ beatmapset_id: null, cover_url: 'x', local_cover_path: '/uploads/covers/default.jpg' }],
    run: async (sql, ...args) => { updates.push({ sql, args }); }
  };
  let downloads = 0;
  const download = async () => { downloads++; };

  await restoreCoversFromCache(db, { coversDir, download });

  assert.equal(downloads, 0);
  assert.deepEqual(updates, []);
  await fs.promises.rm(coversDir, { recursive: true, force: true });
});