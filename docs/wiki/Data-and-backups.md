# Data and backups

## Storage locations

Packaged desktop data survives application updates.

| Platform | Default data directory |
| --- | --- |
| Windows | `%APPDATA%\osu!ReqTrac\data\` |
| macOS | `~/Library/Application Support/osu!ReqTrac/data/` |
| Linux | `~/.config/osu!ReqTrac/data/` |

These are the default Electron locations; system configuration can affect the user-data base directory.

The development backend uses `backend/data/`, including when accessed by Electron through `npm run dev`. This is separate from the packaged app's database.

The data directory contains `database.sqlite` and cached covers in `covers/`. The parent desktop user-data directory holds `window-state.json`. Theme, column, filter, and other interface preferences live in the database.

## Back up and restore

Use **Settings → Data and backups** to export or restore `backup.json`.

A restore replaces requests, categories, tags, history, and other database contents. Export a backup first if you may need the current data again.

Restore keeps this machine's configured osu! credentials and Google tokens instead of replacing them with backup values. Backup credentials are adopted only when none are configured locally.

Current JSON backups contain database records and cached metadata, but do not embed cover image files. Covers can be fetched again. To preserve the complete local state offline, close the app and copy the entire data directory as well.

Backup and restore wait for background metadata work and serialize access to the database. If an older database has a large pending sync queue, this can take time.

## Privacy

Requests are local by default. Network access is used for osu! data, optional Google Sheets publishing, app updates, and remote images such as profile avatars.

Treat the database, backups, and configuration as sensitive. Backups include settings and may contain credentials or tokens; do not publish them.

Google tokens use Electron's OS-backed encryption when available. Standalone development and environments without that facility do not have the same protection.

[Google Sheets publishing](https://github.com/SEApodEErman/osu-ReqTrac/wiki/Google-Sheets) makes a separate copy accessible to anyone with its link. Manual/non-osu! requests are excluded, but notes on published osu!-linked requests are included.
