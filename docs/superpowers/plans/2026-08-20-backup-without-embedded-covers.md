# Backup v5 Without Embedded Covers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship backup schema v5.0.0 — backups no longer embed base64 cover images — and make oversized legacy backups (<v5) auto-strip their covers on import while covers re-download in the background after any restore that lacks them.

**Architecture:** Bump the backup version and drop `cover_files` from export. Change the import route to receive the raw payload (large-limit `express.raw` middleware registered only on that path, ahead of the global 50 MB JSON parser) and strip embedded covers from oversized legacy payloads before validation. After any restore that has no embedded covers, register a tracked background task that re-downloads cover images from the osu! CDN. On the frontend, stream the selected file directly in the fetch body instead of parsing/re-stringifying it.

**Tech Stack:** Node.js 24, Express 4 (`express.json`, `express.raw`), body-parser 1.20.6 (bundled with express), node:test (backend tests), React + Vite (frontend), no new dependencies.

## Global Constraints

- Node.js 24.x and npm 10+; packages installed with `npm run install:all` (no new dependencies in this plan, so no manifest/lockfile changes).
- Backend tests run with `npm test --prefix backend` (node:test). Focus a file: `npm test --prefix backend -- test/backup.test.js`; combine file + name: `npm test --prefix backend -- --test-name-pattern="shouldStripCovers" test/backup.test.js`.
- Frontend has no test/lint/typecheck script; its only verification is `npm run build:frontend`.
- Code style: follow the repo's existing patterns and **add no code comments** unless the surrounding code does.
- `BACKUP_VERSION` is `'5.0.0'`; legacy set is `{'1.0.0', '2.0.0', '3.0.0', '4.0.0'}`.
- Cover strip threshold is `50 * 1024 * 1024` bytes and the import-json payload cap is `'1gb'`; everything else keeps the existing `50mb` cap.
- No git commit without an explicit instruction to commit in the step.

---

### Task 1: Backup schema v5 + strip helper

**Files:**
- Modify: `backend/src/utils/backup.js`
- Test: `backend/test/backup.test.js`

**Interfaces:**
- Consumes: node:test and `node:assert/strict`.
- Produces: `BACKUP_VERSION === '5.0.0'`; `LEGACY_BACKUP_VERSIONS` includes `'4.0.0'`; new exports `COVER_STRIP_THRESHOLD_BYTES` and `shouldStripCovers(backup, bodyByteLength)`.
- `shouldStripCovers(backup, bodyByteLength): boolean` — true iff `bodyByteLength > 50 * 1024 * 1024`, `backup.version` is in `LEGACY_BACKUP_VERSIONS`, and `backup.cover_files` is a non-empty array.

- [ ] **Step 1: Write the failing tests**

Update the import block in `backend/test/backup.test.js`:

```js
const {
  BACKUP_VERSION,
  COVER_STRIP_THRESHOLD_BYTES,
  getCoverStorageUsage,
  readCoverFiles,
  shouldStripCovers,
  validateBackup,
  writeCoverFiles
} = require('../src/utils/backup');
```

Append:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix backend -- test/backup.test.js`
Expected: FAIL — `shouldStripCovers is not a function` (not exported yet) and `Unsupported backup version` for `'5.0.0'`.

- [ ] **Step 3: Implement the schema bump and helper**

In `backend/src/utils/backup.js`, change the two constants at the top:

```js
const BACKUP_VERSION = '5.0.0';
const LEGACY_BACKUP_VERSIONS = new Set(['1.0.0', '2.0.0', '3.0.0', '4.0.0']);
```

Immediately after the `DATA_TABLES` array declaration (before `validateBackup`):

```js
const COVER_STRIP_THRESHOLD_BYTES = 50 * 1024 * 1024;

function shouldStripCovers(backup, bodyByteLength) {
  return bodyByteLength > COVER_STRIP_THRESHOLD_BYTES
    && LEGACY_BACKUP_VERSIONS.has(backup?.version)
    && Array.isArray(backup?.cover_files)
    && backup.cover_files.length > 0;
}
```

In `validateBackup`, update the version error message:

```js
throw new Error(`Unsupported backup version. Expected ${BACKUP_VERSION}, 4.0.0, 3.0.0, 2.0.0, or 1.0.0.`);
```

Update `module.exports` to include the new exports:

```js
module.exports = {
  BACKUP_VERSION,
  COVER_STRIP_THRESHOLD_BYTES,
  DATA_TABLES,
  getCoverStorageUsage,
  readCoverFiles,
  shouldStripCovers,
  validateBackup,
  writeCoverFiles
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix backend -- test/backup.test.js`
Expected: PASS (all tests, including the pre-existing cover round-trip and storage-usage tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/backup.js backend/test/backup.test.js
git commit -m "feat: bump backup schema to v5 and add oversized-legacy cover strip helper"
```

---

### Task 2: Cover restore pass service

**Files:**
- Create: `backend/src/services/coverRestore.js`
- Test: `backend/test/coverRestore.test.js`

**Interfaces:**
- Consumes: the default `download` is `downloadCover(beatmapsetId, coverUrl)` from `backend/src/osuApi.js:320`, which resolves the CDN URL and returns `/uploads/covers/{id}.jpg` or `/uploads/covers/default.jpg` on failure.
- Produces: `restoreCoversFromCache(db, { coversDir, download = downloadCover, concurrency = 6 })` — `db` must expose `all(sql)` returning rows with `beatmapset_id`, `cover_url`, `local_cover_path`, and `run(sql, ...params)`.
- Behavior: for each `beatmap_cache` row with a positive integer `beatmapset_id`, resolves `coversDir/{id}.jpg`; if the file exists, normalizes `local_cover_path` to `/uploads/covers/{id}.jpg` (update only when different); otherwise calls `download(id, cover_url)` and stores the returned path. Failures are logged and skipped. Concurrency is bounded.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/coverRestore.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix backend -- test/coverRestore.test.js`
Expected: FAIL — module not found (`Cannot find module '../src/services/coverRestore'`).

- [ ] **Step 3: Implement the service**

Create `backend/src/services/coverRestore.js`:

```js
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
        console.warn(`[cover-restore] Failed to restore cover for beatmapset ${row.beatmapset_id}:`, error.message);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
}

module.exports = { restoreCoversFromCache };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix backend -- test/coverRestore.test.js`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/coverRestore.js backend/test/coverRestore.test.js
git commit -m "feat: add background cover restore pass for backups without embedded covers"
```

---

### Task 3: Export drops cover_files

**Files:**
- Modify: `backend/src/routes/migration.js`

**Interfaces:**
- Consumes: `BACKUP_VERSION` (unchanged import).
- Produces: v5 export bodies that contain no `cover_files` key. `readCoverFiles` remains imported and used by the legacy import path.

- [ ] **Step 1: Remove cover reading from export**

In `backend/src/routes/migration.js`, inside the `router.get('/export', ...)` handler, delete the line `const cover_files = await readCoverFiles(coversDir);` (currently line 90) and remove the `cover_files,` property from the `backup` object literal (currently the last property, ~line 109). The object literal them becomes:

```js
    const backup = {
      version: BACKUP_VERSION,
      exported_at: new Date().toISOString(),
      requests,
      categories,
      request_categories,
      request_guest_difficulties,
      beatmap_cache,
      users_cache,
      user_username_history,
      unavailable_osu_users,
      beatmap_metadata_sync,
      history,
      tags,
      request_tags,
      settings,
      sqlite_sequence
    };
```

- [ ] **Step 2: Run the backend suite**

Run: `npm test --prefix backend`
Expected: PASS (no behavioral impact on unit-tested utils or other routes).

- [ ] **Step 3: Manual smoke test**

Run the standalone backend:

```bash
node backend/src/index.js
```

In a second terminal:

```bash
curl -s http://127.0.0.1:3001/api/migration/export -o %TEMP%\backup.json
node -e "const b=require('fs').readFileSync(process.env.TEMP+'\\backup.json','utf8');const p=JSON.parse(b);console.log('version',p.version,'cover_files' in p ? 'HAS_COVERS' : 'no covers')"
```

Expected: `version 5.0.0 no covers`. Stop the backend process afterwards.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/migration.js
git commit -m "feat: omit embedded cover images from backup export"
```

---

### Task 4: Import-json accepts large payloads, strips oversized legacy covers, re-downloads covers

**Files:**
- Modify: `backend/src/index.js`
- Modify: `backend/src/routes/migration.js`

**Interfaces:**
- Consumes: `shouldStripCovers` (Task 1), `restoreCoversFromCache` (Task 2), `express.raw` (bundled with Express; body-parser 1.20.6 sets `req._body = true` and later parsers skip — see `backend/node_modules/body-parser/lib/types/raw.js:60`), existing `coversDir` import from `../db` (migration.js line 4).
- Produces: `POST /api/migration/import-json` accepts up to `1gb` of raw JSON as a `Buffer` (all other routes keep `50mb`); the handler strips `cover_files` from oversized legacy payloads before `validateBackup`; after any restore without embedded covers it registers `restoreCoversFromCache(db, { coversDir })` as a tracked background task. The 413 handler reports an accurate limit.

Note: this task must land as one unit. The handler change alone (before the parser switch) still works because it falls back to the non-Buffer path, and the parser switch alone (before the handler change) would break validation; committing them together keeps the app working at every commit.

- [ ] **Step 1: Register the route-specific raw parser before the global JSON parser**

In `backend/src/index.js`, immediately before `app.use(express.json({ limit: REQUEST_BODY_LIMIT }));` (line 33), add:

```js
app.use('/api/migration/import-json', express.raw({ type: 'application/json', limit: '1gb' }));
```

body-parser marks the request parsed (`req._body = true`), so the later global `express.json` skips it. Keep the existing `express.urlencoded` line unchanged.

- [ ] **Step 2: Make the 413 message accurate**

Replace the `entity.too.large` branch of the error handler in `backend/src/index.js`:

```js
  if (err.type === 'entity.too.large') {
    const limitText = err.limit ? `${Math.ceil(err.limit / (1024 * 1024))} MB` : REQUEST_BODY_LIMIT;
    return res.status(413).json({ error: `Request payload is too large. Maximum allowed is ${limitText}.` });
  }
```

- [ ] **Step 3: Update migration.js imports**

In `backend/src/routes/migration.js`:

```js
const { BACKUP_VERSION, readCoverFiles, shouldStripCovers, validateBackup, writeCoverFiles } = require('../utils/backup');
const { trackBackgroundTask, waitForBackgroundTasks } = require('../utils/backgroundTasks');
const { restoreCoversFromCache } = require('../services/coverRestore');
```

- [ ] **Step 4: Parse the buffer and strip oversized legacy covers**

In the `router.post('/import-json', ...)` handler, replace the opening validation block (currently lines 139-144):

```js
    let backup;
    try {
      const raw = req.body;
      if (Buffer.isBuffer(raw)) {
        const candidate = JSON.parse(raw.toString('utf8'));
        if (shouldStripCovers(candidate, raw.byteLength)) {
          delete candidate.cover_files;
        }
        backup = validateBackup(candidate);
      } else {
        backup = validateBackup(raw);
      }
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
```

- [ ] **Step 5: Start the cover restore pass for backups without embedded covers**

In the same handler's success path, after `await initializeMetadataSyncWorker();` and before `res.json({ success: true, message: 'Backup JSON restored successfully' });`, add:

```js
    if (!backup._hasCoverFiles) {
      trackBackgroundTask(restoreCoversFromCache(db, { coversDir }));
    }
```

The call is intentionally not awaited; `waitForBackgroundTasks` on later export/import/delete-all-data calls waits for it under the backup lock.

- [ ] **Step 6: Run the backend suite**

Run: `npm test --prefix backend`
Expected: PASS.

- [ ] **Step 7: Manual smoke test**

With the standalone backend running:
1. Export the current DB and import it back (proves the raw-buffer path works):

```bash
curl -s http://127.0.0.1:3001/api/migration/export -o %TEMP%\backup.json
curl -s -X POST http://127.0.0.1:3001/api/migration/import-json -H "Content-Type: application/json" --data-binary "@%TEMP%\backup.json"
```

Expected: `{"success":true,"message":"Backup JSON restored successfully"}`.

2. Generate a legacy v4 backup with a 60 MB embedded cover and restore it (proves oversized payloads reach the route and covers are stripped):

```bash
node -e "const fs=require('fs');const b={version:'4.0.0',requests:[],categories:[],request_categories:[],request_guest_difficulties:[],beatmap_cache:[],beatmap_metadata_sync:[],users_cache:[],user_username_history:[],history:[],tags:[],request_tags:[],settings:[],sqlite_sequence:[],cover_files:[{filename:'1.jpg',data:'A'.repeat(60*1024*1024)}]};fs.writeFileSync(process.env.TEMP+'\\big-v4.json',JSON.stringify(b))"
```

```bash
curl -s -X POST http://127.0.0.1:3001/api/migration/import-json -H "Content-Type: application/json" --data-binary "@%TEMP%\big-v4.json"
```

Expected: `{"success":true,...}` (no 413 from the 50 MB cap, no `writeCoverFiles` write of the 60 MB blob).

- [ ] **Step 8: Commit**

```bash
git add backend/src/index.js backend/src/routes/migration.js
git commit -m "feat: accept large legacy backups on import and re-download covers after restore"
```

---

### Task 5: Frontend streams the backup file

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/SettingsPanel.jsx`

**Interfaces:**
- Consumes: the import-json route now accepts a raw JSON body (Task 4).
- Produces: `onImportJson(jsonFile)` streams the raw `File` in the fetch body (no `FileReader`/`JSON.parse`/`JSON.stringify`); user-facing copy explains covers are no longer embedded.

- [ ] **Step 1: Stream the file in App.jsx**

Replace the body construction in `handleImportJson` (`frontend/src/App.jsx`), changing the parameter name from `backupObj` to `jsonFile` and the fetch body:

```js
  const handleImportJson = async (jsonFile) => {
    try {
      const res = await fetch('/api/migration/import-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonFile
      });

      const data = await res.json();
      if (res.ok) {
        showToast('Backup database successfully restored!', 'success');
        dashboardCategoryIdRef.current = 'all';
        setDashboardCategoryId('all');
        setStatsData({});
        await fetchData();
        return true;
      } else {
        showToast(`Database Restore Failed: ${data.error}`, 'error');
        return false;
      }
    } catch (e) {
      console.error(e);
      showToast('Database Restore Network Error.', 'error');
      return false;
    }
  };
```

- [ ] **Step 2: Pass the raw file from SettingsPanel**

Replace the reader logic in `handleJsonRestore` (`frontend/src/components/SettingsPanel.jsx`) with a direct call:

```js
    setIsRestoringJson(true);
    try {
      const success = await onImportJson(jsonFile);
      if (success) {
        setJsonFile(null);
        e.target.reset();
      }
    } catch (err) {
      onNotify('Backup restore failed. Make sure you upload a valid backup.json file.', 'error');
    } finally {
      setIsRestoringJson(false);
    }
```

This removes the `FileReader`, `JSON.parse`, and client-side validation; the server reports validation failures through `data.error` in App.jsx.

- [ ] **Step 3: Update the backup copy**

In the Database Backup & Restore card (`frontend/src/components/SettingsPanel.jsx`), keep the description paragraph at the top of the card, and immediately after the "Treat backup.json like a key." warning box add:

```jsx
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Backups no longer embed cover images, keeping them small and fast to export and import. Cover images re-download automatically in the background after a restore.
          </p>
```

- [ ] **Step 4: Build the frontend**

Run: `npm run build:frontend`
Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/components/SettingsPanel.jsx
git commit -m "feat: stream backup upload and note cover re-download in restore UI"
```

---

### Task 6: Full regression verification

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: all prior tasks.

- [ ] **Step 1: Run the full backend suite**

Run: `npm test --prefix backend`
Expected: all tests PASS.

- [ ] **Step 2: Build the renderer**

Run: `npm run build:frontend`
Expected: build succeeds.

- [ ] **Step 3: Report results**

If both commands pass, report success. If any test fails, fix the regression before reporting completion.