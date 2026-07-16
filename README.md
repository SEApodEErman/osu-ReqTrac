<h1 align="center">osu!ReqTrac</h1>

<p align="center">
  <img src="https://seapodeerman.s-ul.eu/JJN07d3w" width="200" alt="osu!ReqTrac logo" />
</p>

<p align="center">A cross-platform desktop application for tracking and managing osu! requests.</p>

## Overview

osu!ReqTrac is a local-first request tracker for osu! beatmap work such as hitsounds, guest difficulties, and storyboards. It stores request data locally in SQLite, caches beatmap metadata for faster access, and can publish a sanitized osu!-linked request table to Google Sheets.

## Features

- **Request management** — Create, edit, organize, and delete requests with statuses, priorities, deadlines, notes, and history logs.
- **Request statuses** — Accepted, Considering, Working, Completed, and Cancelled.
- **Categories and tags** — Track Hitsounds, Guest Difficulties, Storyboards, custom categories, and searchable tags.
- **Individual requests** — Add an osu! beatmap link or create a manual/non-osu entry with artist, title, creator, requester, and an optional reference link.
- **Bulk requests** — Use **Add Multiple Requests** on the Requests page to import one osu! beatmap link per line and assign categories to all imported requests.
- **osu! integration** — Connect an osu! account through OAuth to sync beatmap metadata, covers, difficulties, ranked status, and user information.
- **Beatmap caching** — Cache artist, title, creator, cover art, dates, and difficulties locally for faster access and offline viewing.
- **Dashboard and statistics** — View request totals, status distribution, workload, and other summary information.
- **Bulk operations** — Update statuses, priorities, categories, or delete multiple requests at once.
- **Google Sheets export** — Publish a sanitized, read-only table containing osu!-linked requests.
- **Local-first data** — Request data is stored in the application data directory and persists across updates.
- **Automatic updates** — Packaged desktop builds can receive updates through GitHub Releases.
- **Cross-platform builds** — Windows, macOS, and Linux AppImage distributions are supported.

## Typical Workflow

1. Open the **Requests** page.
2. Select **Add Request** for one request or **Add Multiple Requests** for several osu! links.
3. Select one or more request categories.
4. Review or edit the request details.
5. Open a request to update its status, dates, notes, tags, and category progress.
6. Use **Refresh Added Dates** in Settings when dates need to be refreshed from osu! metadata.

Manual and non-osu! requests remain local. Their reference links can be opened from the request modal, but they are excluded from public Google Sheets exports.

## Screenshots

<p align="center">
  <img src="https://seapodeerman.s-ul.eu/2gedAQwX" alt="osu!ReqTrac dashboard" width="33%" />
  <img src="https://seapodeerman.s-ul.eu/N3Sb3dLH" alt="osu!ReqTrac request list" width="33%" />
  <img src="https://seapodeerman.s-ul.eu/PnSqVxXp" alt="osu!ReqTrac settings" width="33%" />
</p>

## Installation for Users

1. Download the package for your operating system from the [Releases page](https://github.com/SEApodEErman/osu-ReqTrac/releases).
2. Install and open osu!ReqTrac.
3. Complete the first-launch setup if prompted.
4. Configure osu! OAuth in **Settings** if you want automatic metadata and user syncing.

Node.js is not required to run a packaged release.

## Development Setup

### Prerequisites

- Node.js 24.x, matching the CI build environment
- npm 10 or newer
- Git

### Install and Run

```bash
git clone https://github.com/SEApodEErman/osu-ReqTrac.git
cd osu-ReqTrac
npm run install:all
npm run dev
```

The development command starts:

- Backend API: `http://localhost:3001`
- Frontend development server: `http://localhost:3000`
- Electron desktop application

### Useful Commands

```bash
npm run build:frontend       # Build the React frontend
npm run build                # Build the packaged application
npm run build:dir            # Build an unpacked application directory
npm test --prefix backend    # Run backend tests
```

## osu! OAuth Setup

OAuth is optional, but recommended for automatic beatmap metadata and user syncing.

1. Visit <https://osu.ppy.sh/home/account/edit> and open the **OAuth** section.
2. Create a new application.
3. Configure the redirect URI required by the current application setup.
4. Enter the client ID and client secret in **Settings**.
5. Save the configuration and connect the account when prompted.

The application uses osu! as an external service. API availability, rate limits, returned data, and account access are controlled by osu! and its API policies.

## Google Sheets Export

The application can publish a sanitized, read-only copy of osu!-linked request data to Google Drive as a Google Sheet.

To configure Google Sheets for a development build:

1. Create a project in Google Cloud Console.
2. Enable the Google Sheets API and Google Drive API.
3. Create an OAuth client for a desktop application.
4. Copy `backend/google-oauth.json.example` to `backend/google-oauth.json`.
5. Add the client ID to the configuration file.
6. Build and start osu!ReqTrac.
7. Open **Settings** → **Public Google Sheet** and connect Google Drive.

The export includes osu!-linked request metadata, categories, tags, statuses, dates, difficulties, and osu! links. It excludes manual/non-osu entries, Discord links, OAuth credentials, settings, and database internals.

Disconnecting Google Drive removes the local OAuth tokens but does not delete an existing Google Sheet.

## Data Storage and Backups

Request data is stored in the application data directory and persists across application updates.

| Operating system | Data directory |
| --- | --- |
| Windows | `%APPDATA%\\osu!ReqTrac\\data\\` |
| macOS | `~/Library/Application Support/osu!ReqTrac/data/` |
| Linux | `~/.config/osu!ReqTrac/data/` |

The directory contains:

- `database.sqlite` — Requests, categories, tags, history, settings, and cached metadata.
- `covers/` — Cached beatmap cover images.

Use **Settings** → **Database Backup & Restore** to export or restore a `backup.json` file. Back up the database before reinstalling, changing versions, or restoring data.

## Privacy and Security

ReqTrac is designed to keep request data local by default. Network access is used for osu! API calls, optional Google Sheets publishing, application updates, and other explicitly enabled integrations.

Treat the local database and configuration files as sensitive. Google tokens are protected using the operating system credential store when available. Do not commit OAuth credentials or local configuration files to the repository.

## Contributing

1. Fork the repository.
2. Create a feature branch:

   ```bash
   git checkout -b feature/my-feature
   ```

3. Make and test your changes.
4. Run the backend test suite:

   ```bash
   npm test --prefix backend
   ```

5. Open a pull request with a clear description of the change.

Bug reports and feature suggestions are welcome through [GitHub Issues](https://github.com/SEApodEErman/osu-ReqTrac/issues). You can also contact the maintainer through the [Discord server](https://discord.gg/Z5VFCdkExJ).

## License and Trademark Notice

The original source code and original assets in this repository are licensed under the [MIT License](LICENSE).

osu!ReqTrac is an independent, community-developed application and is not affiliated with, endorsed by, or sponsored by osu! or ppy Pty Ltd. The names osu!, ppy, related logos, visual identity, website content, user content, and other branding remain the property of their respective owners. See the [osu! brand identity guidelines](https://osu.ppy.sh/wiki/en/Brand_identity_guidelines) for appropriate use of osu!-related marks.

This application uses the [osu! API](https://osu.ppy.sh/docs/) as an external service. Users are responsible for complying with the [osu! Terms of Use](https://osu.ppy.sh/legal/en/Terms), API documentation, rate limits, and other applicable usage restrictions.

## Credits

- Vibe coded using the following tools: [Google's Antigravity](https://antigravity.google/), [OpenAI's Codex](https://chatgpt.com/codex/), and [OpenCode Zen](https://opencode.ai/zen).
- osu! API: <https://osu.ppy.sh/docs/index.html>
- Icons: [lucide-react](https://lucide.dev/)
- Built with Electron, React, Vite, Express, and SQLite.
