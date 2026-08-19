# Backup Schema v5.0.0 — No Embedded Cover Images

**Date:** 2026-08-20
**Status:** Approved design (pending spec review)

## Overview

Backups with more than ~1,000 entries grow to hundreds of megabytes because the
backup JSON embeds every cover image as base64. This makes export/import slow,
forces a raised JSON body limit, and occasionally freezes the browser during
restore (the frontend reads the whole file, `JSON.parse`s it, then
`JSON.stringify`s it back before upload).

This spec changes the backup schema so cover image *data* is no longer embedded.
Cover images are derived deterministically from `beatmapset_id`
(`https://assets.ppy.sh/beatmaps/{id}/covers/cover.jpg`) and are cached locally
under `coversDir/{beatmapset_id}.jpg`, so they can be re-downloaded in the
background after a restore. Oversized legacy backups (< v5) are automatically
converted on import by stripping their coded covers.

## Goals

- New backups (v5.0.0) are small (only database tables; no cover binary data).
- Export and import are fast regardless of how many beatmapsets are cached.
- Restoring a backup re-downloads covers automatically in the background; the UI
  falls back to `default.jpg` while they fill in.
- Existing backups v1.0.0–v4.0.0 remain importable.
- Legacy backups over the old 50 MB JSON cap restore automatically: their coded
  cover data is stripped on import (covers re-download instead).
- The global `50mb` Express body limit stays unchanged.

## Non-Goals

- Not switching to a ZIP/archive backup format.
- Not shipping cover images in backups under any circumstances going forward.
- Not pruning stale cover files on v5 imports.

## Terminology

- **Backup** — a single `backup.json` file produced by `GET /api/migration/export`.
- **cover_files** — the backup field holding `{ filename, data(base64) }` entries.
- **Cover restore pass** — a background task that re-downloads cover images after
  a restore that did not include cover data.

## Current Behavior (baseline)

- `backend/src/utils/backup.js`
  - `BACKUP_VERSION = '4.0.0'`; `LEGACY_BACKUP_VERSIONS = {1.0.0, 2.0.0, 3.0.0}`.
  - `validateBackup` requires all `DATA_TABLES` (with per-version exceptions),
    normalizes optional legacy fields, and flags `_hasCoverFiles` from the
    presence of `cover_files`.
  - `readCoverFiles` base64-encodes every `*.jpg` in `coversDir` (excluding
    `default.jpg`).
  - `writeCoverFiles` writes a supplied cover list and prunes stale covers.
- `backend/src/routes/migration.js`
  - `GET /export` (line 66) reads every cover via `readCoverFiles` (line 90) and
    embeds it in the backup object (line 109).
  - `POST /import-json` (line 132) validates, clears tables, re-inserts them, and
    when `backup._hasCoverFiles` writes covers via `writeCoverFiles` (lines
    308–312).
- `backend/src/index.js`
  - `app.use(express.json({ limit: '50mb' }))` (line 33) rejects any body above
    50 MB before the route runs (413 via the handler at lines 84–90).
- `frontend/src/components/SettingsPanel.jsx`
  - `handleJsonRestore` (line 344) uses `FileReader.readAsText`, `JSON.parse`,
    then `App.handleImportJson` re-`JSON.stringify`s the object into the request
    body (`frontend/src/App.jsx:732`).
- `backend/src/osuApi.js`
  - `downloadCover(beatmapsetId, coverUrl)` (line 320) downloads from the CDN
    URL (or `https://assets.ppy.sh/beatmaps/{id}/covers/cover.jpg`), writes
    `coversDir/{id}.jpg`, and returns `/uploads/covers/{id}.jpg` or
    `/uploads/covers/default.jpg` on failure.
- `backend/src/utils/backgroundTasks.js`
  - `trackBackgroundTask`/`waitForBackgroundTasks` serialize backup-affecting
    operations (export/import/delete-all-data await background tasks).

## Design

### 1. Schema version

`backend/src/utils/backup.js`:

- `BACKUP_VERSION = '5.0.0'`.
- `LEGACY_BACKUP_VERSIONS = new Set(['1.0.0', '2.0.0', '3.0.0', '4.0.0'])`.
- Unsupported-version error message updated to include `4.0.0`.
- v5 backups carry no `cover_files` key; `validateBackup` already returns
  `_hasCoverFiles: false` when the key is absent, so no structural change is
  needed beyond the version bump.
- `readCoverFiles`, `writeCoverFiles`, and `getCoverStorageUsage` remain exported:
  `delete-all-data` (`settings.js`) and legacy embedded-cover imports still use them.

### 2. Export

`backend/src/routes/migration.js` `GET /export`:

- Remove the `readCoverFiles(coversDir)` call.
- Remove `cover_files` from the backup object.
- Everything else (all tables, `sqlite_sequence`, `version: BACKUP_VERSION`,
  JSON response, `Content-Disposition: attachment; filename=backup.json`) is
  unchanged.

Result: export reads only the database; the response is a few MB even for large
databases.

### 3. New cover restore pass

New module `backend/src/services/coverRestore.js`:

```js
async function restoreCoversFromCache(db, { coversDir, download = downloadCover, concurrency = 6 } = {})
```

- Selects `beatmapset_id, cover_url, local_cover_path` from `beatmap_cache` where
  `beatmapset_id` is a positive integer.
- For each row, resolves the local file `path.join(coversDir, `${id}.jpg`)`:
  - File exists → target path is `/uploads/covers/{id}.jpg`; update
    `local_cover_path` only when it differs.
  - File missing → `download(id, cover_url)`; update `local_cover_path` to the
    returned path (`downloadCover` returns `default.jpg` on failure).
- Runs with bounded concurrency and per-row try/catch (a failed cover never fails
  the restore).
- `coversDir` is required and is passed by the migration route (it already imports
  the shared `coversDir` from `../db`); `download` defaults to the real
  `downloadCover` and `concurrency` defaults to 6. `download` is injectable for
  tests.

### 4. Import

`backend/src/routes/migration.js` `POST /import-json`:

- Legacy embedded-cover path (v1–v4 with `_hasCoverFiles`) is unchanged:
  `writeCoverFiles(coversDir, backup.cover_files)` still restores them
  offline-faithfully.
- v5 path: `_hasCoverFiles` is false, so no cover writes. After `COMMIT`,
  `PRAGMA foreign_keys = ON`, and `initializeMetadataSyncWorker()`, register the
  cover restore pass as a tracked background task before responding:

  ```js
  if (!backup._hasCoverFiles) {
    trackBackgroundTask(restoreCoversFromCache(db));
  }
  ```

  The call is not awaited, so the import response stays fast; any subsequent
  export/import/delete-all-data already awaits background tasks under the backup
  lock, so the pass cannot race SQLite writes.

### 5. Automatic conversion of oversized legacy backups

`backend/src/index.js`:

- Before the global `express.json` middleware, register a raw-body parser only on
  the import-json route:

  ```js
  app.use('/api/migration/import-json', express.raw({ type: 'application/json', limit: '1gb' }));
  ```

  body-parser 1.20.6 sets `req._body` and skips later parsers (`types/raw.js:60`,
  `types/json.js:106`), so the global `express.json` (50 MB) is bypassed **only**
  for this route. All other routes keep the 50 MB cap.

`backend/src/utils/backup.js`:

- Add a pure, testable helper:

  ```js
  const COVER_STRIP_THRESHOLD_BYTES = 50 * 1024 * 1024;

  function shouldStripCovers(backup, bodyByteLength) {
    return bodyByteLength > COVER_STRIP_THRESHOLD_BYTES
      && LEGACY_BACKUP_VERSIONS.has(backup.version)
      && Array.isArray(backup.cover_files) && backup.cover_files.length > 0;
  }
  ```

  `COVER_STRIP_THRESHOLD_BYTES` and `shouldStripCovers` are exported for tests.

`POST /import-json` handler:

- `req.body` is a `Buffer`; parse it, then:

  ```js
  let backup = JSON.parse(req.body.toString('utf8'));
  if (shouldStripCovers(backup, req.body.byteLength)) {
    delete backup.cover_files; // in-memory equivalent of a temporary stripped .json
  }
  backup = validateBackup(backup);
  ```

- After stripping, `_hasCoverFiles: false` → tables restore and the cover restore
  pass re-downloads covers, exactly like v5. Table-restore semantics for legacy
  versions are unchanged (categories/guest-difficulty branches key off
  `backup.version === BACKUP_VERSION`, which remains the original legacy number).

`backend/src/index.js` error handler:

- The `entity.too.large` 413 message currently stringifies the fixed 50 MB cap
  (line 87). Replace it with a generic message derived from `err.limit` (e.g.
  "Request payload is too large. Maximum allowed is <limit>.") so it is accurate
  for both the global cap and the 1 GB import cap.

### 6. Frontend streaming upload

`frontend/src/App.jsx` `handleImportJson(file)`:

- Replace `JSON.stringify(backupObj)` with a direct streaming upload of the raw
  `File`:

  ```js
  const res = await fetch('/api/migration/import-json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: file
  });
  ```

- Keep the existing toast/error handling using `data.error` from `res.json()`.

`frontend/src/components/SettingsPanel.jsx`:

- `handleJsonRestore` passes the raw `jsonFile` to `onImportJson` (no
  `FileReader`, no `JSON.parse`, no client-side JSON validation).
- Update the Database Backup & Restore copy to state that backups no longer embed
  cover images and covers re-download automatically after a restore.

This removes the browser-side giant-JSON parse entirely (the reported freeze) for
all imports, new and legacy.

## Error Handling

- Rejects with 400 (existing `validateBackup` messages) for malformed JSON or
  incomplete backups; `JSON.parse` failures surface as a 400 with a clear message.
- Covers that fail to download are non-fatal; the row's `local_cover_path` points
  at `/uploads/covers/default.jpg` and the UI's existing `onError` fallbacks show
  the default cover.
- Payloads above the 1 GB import cap return 413 with the generic limit message.
- The cover restore pass is a tracked background task, so future
  export/import/delete-all-data waits for it under the backup lock; no SQLite
  write races.

## Backward Compatibility

- v1.0.0–v4.0.0 backups import unchanged when ≤ 50 MB (embedded covers still
  written offline-faithfully).
- v1.0.0–v4.0.0 backups > 50 MB import automatically with covers stripped and
  re-downloaded.
- v5.0.0 backups import with covers re-downloaded in the background.
- Export always produces v5.0.0 (no embedded covers) going forward.
- Stale on-disk covers left by a v5/stripped restore are harmless cache and are
  cleared by the existing "Delete all data" flow.

## Testing

- `backend/test/backup.test.js`:
  - A v5 backup without `cover_files` passes `validateBackup` with
    `_hasCoverFiles: false`.
  - `shouldStripCovers` returns true only for legacy versions with non-empty
    `cover_files` above the byte threshold (and false for v5, empty arrays, and
    ≤ threshold).
  - `4.0.0` is accepted as a supported legacy version.
- New `backend/test/coverRestore.test.js` (temp covers dir, in-memory db stub,
  injected `download`): missing cover is downloaded and `local_cover_path`
  updated; existing file normalizes the path without downloading; failed download
  sets `default.jpg`; non-numeric/absent beatmapset IDs are skipped.
- `backend/test/migrationRoute.test.js` unchanged.

## Risks

- `JSON.parse` of a buffer just under 1 GB is a temporary memory spike on the
  backend host. Acceptable for a local desktop/standalone app; the 1 GB cap bounds
  worst-case memory. If multi-GB backups ever appear, a streaming JSON parser is
  the follow-up.
- `express.raw` only matches when the client sends `Content-Type: application/json`
  (the in-app flow always does). Other clients posting without a matching type
  still get the global 50 MB cap, which is fine for v5-sized payloads.

## Out of Scope

- ZIP/archive backup formats.
- Pruning stale covers on v5 imports.
- Streaming JSON parsing (future if multi-GB backups appear).
- Changes to `getCoverStorageUsage`/data-usage semantics.