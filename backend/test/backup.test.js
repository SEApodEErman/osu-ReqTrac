const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  BACKUP_VERSION,
  readCoverFiles,
  validateBackup,
  writeCoverFiles
} = require('../src/utils/backup');

function completeBackup(overrides = {}) {
  return {
    version: BACKUP_VERSION,
    requests: [],
    request_categories: [],
    beatmap_cache: [],
    beatmap_metadata_sync: [],
    users_cache: [],
    history: [],
    tags: [],
    request_tags: [],
    settings: [],
    ...overrides
  };
}

test('validateBackup rejects partial backups and normalizes optional legacy data', () => {
  assert.throws(() => validateBackup({ version: BACKUP_VERSION, requests: [] }), /incomplete/);

  const backup = validateBackup({
    version: '1.0.0',
    requests: [],
    request_categories: [],
    beatmap_cache: [],
    users_cache: [],
    history: [],
    tags: [],
    request_tags: [],
    settings: []
  });

  assert.deepEqual(backup.beatmap_metadata_sync, []);
  assert.deepEqual(backup.cover_files, []);
  assert.deepEqual(backup.sqlite_sequence, []);
});

test('validateBackup rejects unsupported versions', () => {
  assert.throws(() => validateBackup(completeBackup({ version: '9.0.0' })), /Unsupported backup version/);
});

test('cover files round-trip and stale covers are removed', async () => {
  const coversDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reqtrac-covers-'));
  await fs.promises.writeFile(path.join(coversDir, '10.jpg'), Buffer.from('cover-data'));
  await fs.promises.writeFile(path.join(coversDir, 'stale.jpg'), Buffer.from('stale'));

  const files = await readCoverFiles(coversDir);
  assert.deepEqual(files.map(file => file.filename), ['10.jpg', 'stale.jpg']);

  await writeCoverFiles(coversDir, [{ filename: '10.jpg', data: Buffer.from('new-cover').toString('base64') }]);
  assert.equal(await fs.promises.readFile(path.join(coversDir, '10.jpg'), 'utf8'), 'new-cover');
  await assert.rejects(fs.promises.access(path.join(coversDir, 'stale.jpg')));
  await fs.promises.rm(coversDir, { recursive: true, force: true });
});
