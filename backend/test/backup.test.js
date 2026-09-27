const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  BACKUP_VERSION,
  COVER_STRIP_THRESHOLD_BYTES,
  LOCAL_CREDENTIAL_SETTING_KEYS,
  getCoverStorageUsage,
  mergeSettingsForRestore,
  readCoverFiles,
  shouldStripCovers,
  validateBackup,
  writeCoverFiles
} = require('../src/utils/backup');

function completeBackup(overrides = {}) {
  return {
    version: BACKUP_VERSION,
    requests: [],
    categories: [],
    request_categories: [],
    request_guest_difficulties: [],
    beatmap_cache: [],
    beatmap_metadata_sync: [],
    users_cache: [],
    user_username_history: [],
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
  assert.deepEqual(backup.unavailable_osu_users, []);
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

test('getCoverStorageUsage totals cached cover files only', async () => {
  const coversDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reqtrac-cover-usage-'));
  await fs.promises.writeFile(path.join(coversDir, '10.jpg'), Buffer.alloc(10));
  await fs.promises.writeFile(path.join(coversDir, '20.jpeg'), Buffer.alloc(20));
  await fs.promises.writeFile(path.join(coversDir, 'default.jpg'), Buffer.alloc(40));
  await fs.promises.writeFile(path.join(coversDir, 'notes.txt'), Buffer.alloc(80));

  assert.deepEqual(await getCoverStorageUsage(coversDir), { bytes: 30, fileCount: 2 });
  await fs.promises.rm(coversDir, { recursive: true, force: true });
});

test('validateBackup accepts v5 backups without cover_files', () => {
  const backup = validateBackup(completeBackup({ version: '5.0.0' }));
  assert.equal(backup._hasCoverFiles, false);
  assert.deepEqual(backup.cover_files, []);
});

test('validateBackup accepts 4.0.0 as a legacy version', () => {
  const backup = validateBackup(completeBackup({ version: '4.0.0' }));
  assert.equal(backup.version, '4.0.0');
});

test('shouldStripCovers only strips oversized legacy backups with covers', () => {
  const legacy = { version: '4.0.0', cover_files: [{ filename: '1.jpg', data: 'x' }] };
  const base = COVER_STRIP_THRESHOLD_BYTES;
  assert.equal(shouldStripCovers(legacy, base), false);
  assert.equal(shouldStripCovers(legacy, base + 1), true);
  assert.equal(shouldStripCovers({ ...legacy, version: BACKUP_VERSION }, base + 1), false);
  assert.equal(shouldStripCovers({ ...legacy, cover_files: [] }, base + 1), false);
  assert.equal(shouldStripCovers({ ...legacy, version: '9.0.0' }, base + 1), false);
});

test('restore keeps this machine\'s OAuth credentials over backup values', () => {
  const merged = mergeSettingsForRestore(
    [
      { key: 'osu_client_id', value: 'attacker-id' },
      { key: 'osu_client_secret', value: 'attacker-secret' },
      { key: 'google_refresh_token', value: 'attacker-token' },
      { key: 'google_access_token', value: 'attacker-access' },
      { key: 'connected_username', value: 'from-backup' },
    ],
    [
      { key: 'osu_client_id', value: 'local-id' },
      { key: 'osu_client_secret', value: 'local-secret' },
      { key: 'google_refresh_token', value: 'local-token' },
      { key: 'google_access_token', value: '' },
    ]
  );

  const byKey = Object.fromEntries(merged.map(row => [row.key, row.value]));
  assert.equal(byKey.osu_client_id, 'local-id');
  assert.equal(byKey.osu_client_secret, 'local-secret');
  assert.equal(byKey.google_refresh_token, 'local-token');
  assert.equal(byKey.connected_username, 'from-backup');
});

test('restore adopts backup credentials only when none exist locally', () => {
  const merged = mergeSettingsForRestore(
    [
      { key: 'osu_client_id', value: 'backup-id' },
      { key: 'osu_client_secret', value: 'backup-secret' },
      { key: 'google_access_token', value: 'local-empty-skipped' },
    ],
    [
      { key: 'google_access_token', value: '' },
    ]
  );

  const byKey = Object.fromEntries(merged.map(row => [row.key, row.value]));
  assert.equal(byKey.osu_client_id, 'backup-id');
  assert.equal(byKey.osu_client_secret, 'backup-secret');
  assert.equal(byKey.google_access_token, 'local-empty-skipped', 'empty local rows do not block backup values');
});

test('restore writes all non-credential settings from the backup', () => {
  const merged = mergeSettingsForRestore(
    [
      { key: 'connected_username', value: 'someone' },
      { key: 'google_sheet_id', value: 'sheet-123' },
    ],
    [{ key: 'osu_client_id', value: 'local-id' }]
  );

  assert.deepEqual(merged.slice(0, 2), [
    { key: 'connected_username', value: 'someone' },
    { key: 'google_sheet_id', value: 'sheet-123' },
  ]);
  assert.deepEqual(merged[2], { key: 'osu_client_id', value: 'local-id' });
});

test('restore tolerates empty settings tables and preserves only known credential keys', () => {
  assert.deepEqual(mergeSettingsForRestore(undefined, undefined), []);
  const merged = mergeSettingsForRestore(
    [],
    [
      { key: 'some_other_key', value: 'not-a-credential' },
      { key: 'osu_client_secret', value: 'local-secret' },
    ]
  );
  assert.deepEqual(merged, [{ key: 'osu_client_secret', value: 'local-secret' }]);
  assert.equal(LOCAL_CREDENTIAL_SETTING_KEYS.includes('connected_username'), false);
});
