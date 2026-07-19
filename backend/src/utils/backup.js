const fs = require('fs');
const path = require('path');

const BACKUP_VERSION = '3.0.0';
const LEGACY_BACKUP_VERSIONS = new Set(['1.0.0', '2.0.0']);
const DATA_TABLES = [
  'requests',
  'categories',
  'request_categories',
  'request_guest_difficulties',
  'beatmap_cache',
  'beatmap_metadata_sync',
  'users_cache',
  'history',
  'tags',
  'request_tags',
  'settings'
];

function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    throw new Error('Invalid backup JSON structure.');
  }
  if (backup.version !== BACKUP_VERSION && !LEGACY_BACKUP_VERSIONS.has(backup.version)) {
    throw new Error(`Unsupported backup version. Expected ${BACKUP_VERSION}, 2.0.0, or 1.0.0.`);
  }
  for (const table of DATA_TABLES.filter(table => {
    if (['categories', 'request_guest_difficulties'].includes(table)) return backup.version === BACKUP_VERSION;
    if (table === 'beatmap_metadata_sync') return backup.version !== '1.0.0';
    return true;
  })) {
    if (!Array.isArray(backup[table])) {
      throw new Error(`Backup is incomplete: missing ${table} data.`);
    }
  }
  if (backup.version === '1.0.0' && backup.beatmap_metadata_sync !== undefined && !Array.isArray(backup.beatmap_metadata_sync)) {
    throw new Error('Backup beatmap_metadata_sync must be an array.');
  }
  if (backup.cover_files !== undefined && !Array.isArray(backup.cover_files)) {
    throw new Error('Backup cover_files must be an array.');
  }
  if (backup.sqlite_sequence !== undefined && !Array.isArray(backup.sqlite_sequence)) {
    throw new Error('Backup sqlite_sequence must be an array.');
  }
  return {
    ...backup,
    _hasCoverFiles: Array.isArray(backup.cover_files),
    categories: backup.categories || [],
    request_guest_difficulties: backup.request_guest_difficulties || [],
    beatmap_metadata_sync: backup.beatmap_metadata_sync || [],
    cover_files: backup.cover_files || [],
    sqlite_sequence: backup.sqlite_sequence || []
  };
}

async function readCoverFiles(coversDir) {
  const coverFiles = [];
  for (const filename of await fs.promises.readdir(coversDir)) {
    if (filename === 'default.jpg' || !/\.jpe?g$/i.test(filename)) continue;
    const filePath = path.join(coversDir, filename);
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) continue;
    coverFiles.push({ filename, data: (await fs.promises.readFile(filePath)).toString('base64') });
  }
  return coverFiles;
}

function safeCoverFilename(filename) {
  const safeName = path.basename(String(filename || ''));
  if (!safeName || safeName !== filename || !/^[A-Za-z0-9_.-]+\.jpe?g$/i.test(safeName)) {
    throw new Error(`Invalid cover filename in backup: ${filename}`);
  }
  return safeName;
}

async function writeCoverFiles(coversDir, coverFiles = []) {
  const allowed = new Set();
  for (const cover of coverFiles) {
    const filename = safeCoverFilename(cover.filename);
    const data = Buffer.from(String(cover.data || ''), 'base64');
    await fs.promises.writeFile(path.join(coversDir, filename), data);
    allowed.add(filename);
  }

  for (const filename of await fs.promises.readdir(coversDir)) {
    if (filename !== 'default.jpg' && /\.jpe?g$/i.test(filename) && !allowed.has(filename)) {
      await fs.promises.unlink(path.join(coversDir, filename));
    }
  }
}

module.exports = {
  BACKUP_VERSION,
  DATA_TABLES,
  readCoverFiles,
  validateBackup,
  writeCoverFiles
};
