# Google Sheets

## Import a public sheet

Choose **Import → Spreadsheet or Google Sheet** and paste a Google Sheets URL.

The sheet must be accessible to anyone with the link. ReqTrac downloads it and provides column mapping and a preview before import. This does not require connecting your Google account to ReqTrac.

CSV, `.xlsx`, and `.xls` files use the same import dialog.

## Publish your requests

Official releases include the Google OAuth application configuration.

1. Open **Settings → Google Sheets**.
2. Connect Google Drive and finish authorization in your browser.
3. Return to ReqTrac and sync the sheet.
4. Share the resulting link.

The generated sheet is viewable by **anyone with its link**. Sync it again whenever you want it to match the app. It is a published copy, not a two-way synchronization.

Publishing includes osu!-linked map details, difficulties, statuses, priorities, deadlines, added/completed dates, and notes. The dashboard includes requester statistics. Requests are organized into category sheets.

Manual/non-osu! requests, Discord links, OAuth credentials, settings, and database internals are excluded. Notes on osu!-linked requests are included, so review them before publishing.

Disconnecting clears the local Google connection and stored sheet reference. It does not delete the sheet or revoke its existing public sharing.

## Configure a development build

1. Create a Google Cloud project.
2. Enable the Google Sheets API and Google Drive API.
3. Create an OAuth client for a **desktop application**.
4. Copy `backend/google-oauth.json.example` to `backend/google-oauth.json`.
5. Put the desktop client ID in `clientId`. The example also has a `clientSecret` field; the current configuration loader accepts an optional secret.
6. Restart the backend or desktop app and connect through **Settings → Google Sheets**.

Alternatively, set `GOOGLE_CLIENT_ID` and optional `GOOGLE_CLIENT_SECRET` in `backend/.env`. Values in `backend/google-oauth.json` take precedence when present.

Keep both configuration files out of Git. CI creates the bundled configuration from repository secrets; see [Releasing](https://github.com/SEApodEErman/osu-ReqTrac/wiki/Releasing).
