const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const {
  processMetadataSyncEntry,
  queueBeatmapMetadata
} = require('../src/services/beatmapMetadataSync');

test('queueBeatmapMetadata stores provisional data and deduplicates queue entries', async () => {
  let cache = null;
  let sync = null;
  const statements = [];
  const db = {
    get: async (sql) => {
      if (sql.includes('FROM beatmap_cache')) return cache;
      if (sql.includes('FROM beatmap_metadata_sync')) return sync;
      return null;
    },
    run: async (sql) => {
      statements.push(sql);
      if (sql.includes('INTO beatmap_cache')) cache = { metadata_complete: 0 };
      if (sql.includes('INTO beatmap_metadata_sync')) sync = { status: 'Pending' };
      return { changes: 1 };
    }
  };
  const provisional = { artist: 'Artist', title: 'Title', creator: 'Mapper', user_id: 2 };

  assert.equal(await queueBeatmapMetadata(db, 1, provisional), 'queued');
  assert.equal(await queueBeatmapMetadata(db, 1, provisional), 'queued');
  assert.equal(statements.filter(sql => sql.includes('INTO beatmap_metadata_sync')).length, 1);
});

test('queueBeatmapMetadata writes a valid provisional cache and persistent queue row', async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE beatmap_cache (
      beatmapset_id INTEGER PRIMARY KEY, artist TEXT NOT NULL, title TEXT NOT NULL,
      creator TEXT NOT NULL, creator_id INTEGER NOT NULL, cover_url TEXT NOT NULL,
      local_cover_path TEXT NOT NULL, ranked_status TEXT NOT NULL,
      difficulties_json TEXT NOT NULL, metadata_complete INTEGER NOT NULL DEFAULT 1,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE beatmap_metadata_sync (
      beatmapset_id INTEGER PRIMARY KEY, status TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT, next_attempt_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await queueBeatmapMetadata(db, 10, {
    artist: 'Artist', title: 'Title', creator: 'Mapper', user_id: 20,
    covers: { cover: 'cover' }, status: 'ranked'
  });
  await queueBeatmapMetadata(db, 10);

  const cache = await db.get('SELECT * FROM beatmap_cache WHERE beatmapset_id = 10');
  const queueRows = await db.all('SELECT * FROM beatmap_metadata_sync');
  assert.equal(cache.metadata_complete, 0);
  assert.equal(cache.title, 'Title');
  assert.equal(queueRows.length, 1);
  assert.equal(queueRows[0].status, 'Pending');
  await db.close();
});

test('processMetadataSyncEntry marks cache and queue complete after one refresh', async () => {
  const statements = [];
  let refreshes = 0;
  const db = {
    run: async (sql) => {
      statements.push(sql);
      return { changes: 1 };
    }
  };

  const processed = await processMetadataSyncEntry(db, { beatmapset_id: 1, attempt_count: 0 }, async () => {
    refreshes++;
  });

  assert.equal(processed, true);
  assert.equal(refreshes, 1);
  assert.ok(statements.some(sql => sql.includes('metadata_complete = 1')));
  assert.ok(statements.some(sql => sql.includes("status = 'Completed'")));
});

test('processMetadataSyncEntry stops retrying after the third failed attempt', async () => {
  const statements = [];
  const db = {
    run: async (sql) => {
      statements.push(sql);
      return { changes: 1 };
    }
  };

  await processMetadataSyncEntry(db, { beatmapset_id: 1, attempt_count: 2 }, async () => {
    throw new Error('not found');
  });

  assert.ok(statements.some(sql => sql.includes("status = 'Failed'")));
  assert.ok(!statements.some(sql => sql.includes("SET status = 'Pending'")));
});
