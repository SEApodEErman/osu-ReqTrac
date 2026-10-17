<h1 align="center">osu!ReqTrac</h1>

<p align="center">
  <img src="https://seapodeerman.s-ul.eu/JJN07d3w" width="200" alt="osu!ReqTrac logo" />
</p>

<p align="center">A cross-platform desktop application for tracking and managing osu! requests.</p>

## Overview

osu!ReqTrac is a local-first request tracker for osu! beatmap work such as hitsounds, guest difficulties, and storyboards. It stores request data locally in SQLite, caches beatmap metadata for faster access, and can publish a sanitized osu!-linked request table to Google Sheets.

## Features

- **Overview that tells you what to do next** — Overdue and due-this-week requests, high-priority work you haven't started, requests waiting for your decision, and maps whose details failed to sync, each one click away from a filtered list.
- **Add a request by pasting a link** — ReqTrac previews the beatmap (cover, mapper, difficulties) as you paste, remembers the categories you used last, pre-selects the difficulties you own for guest difficulty requests, and catches maps you already track.
- **Requests for anything** — Hitsounds, guest difficulties, storyboards, and your own categories. Requests without an osu! link (unuploaded maps, Drive or Discord links) work too, and can be linked to osu! later.
- **Fast request table** — osu!-style search (`creator="..." stars>=5.5 mode=mania keys=7 added>=2026-01-01`), status, priority, deadline, and tag filters, sortable and reorderable columns, compact rows, keyboard navigation, shift-click range selection, and CSV export. Filters and layout are remembered per category.
- **Bulk changes** — Set status or priority, add or move categories, tag, set added dates from osu!, export, or delete many requests at once. Deletes can be undone for a few seconds.
- **Imports** — Paste a list of beatmap links, or import a CSV, Excel, or public Google Sheets spreadsheet with guided column matching.
- **osu! metadata** — Titles, mappers (including renamed users), difficulties, star ratings, ranked status, dates, and covers are cached locally for fast, offline viewing.
- **Respectful of osu!'s rate limits** — API calls are paced at osu!'s recommended rate; anything you click goes ahead of background syncing, and bulk refreshes look up 50 maps per call.
- **Google Sheets publishing** — Publish a read-only copy of your osu!-linked requests to your own Google Drive.
- **Local-first data** — Everything lives on your computer and survives updates. Back up and restore with one file.
- **Desktop niceties** — Remembers window size and position, keyboard shortcuts (press <kbd>?</kbd>), zoom, drag a beatmap link onto the window to add it, and an offer to add osu! links you copy.
- **Automatic updates** and **Windows, macOS, and Linux** builds.

## Typical Workflow

1. Copy a beatmap link from osu!, Discord, or the forum. ReqTrac offers to add it when you switch back (or press <kbd>Ctrl</kbd>+<kbd>N</kbd> and paste).
2. Pick what was requested — hitsounds, a guest difficulty, a storyboard — and optionally a deadline.
3. Work from the **Overview**: it lists what's overdue, due soon, and waiting on you.
4. Change status and priority straight from the request table, or open a request to edit everything else.

Manual and non-osu! requests stay local. Their reference links can be opened from the request, but they are excluded from public Google Sheets exports.

## Screenshots

<p align="center">
  <img src="https://seapodeerman.s-ul.eu/q1W6qFCr" alt="osu!ReqTrac dashboard" width="33%" />
  <img src="https://seapodeerman.s-ul.eu/OG2zDP7x" alt="osu!ReqTrac request list" width="33%" />
  <img src="https://seapodeerman.s-ul.eu/uPvcQ997" alt="osu!ReqTrac requests pop-up" width="33%" />
</p>

## Installation for Users

1. Download the package for your operating system from the [Releases page](https://github.com/SEApodEErman/osu-ReqTrac/releases).
2. Install and open osu!ReqTrac.
3. Follow the first-run setup: connect the osu! API (see below) and tell ReqTrac your osu! username. Both steps can be skipped and done later in **Settings**.

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

## osu! API Setup

ReqTrac reads public beatmap and profile data from osu! with your own OAuth application. It never signs in as you.

1. Open your [osu! account settings](https://osu.ppy.sh/home/account/edit#oauth) and scroll to **OAuth**.
2. Click **New OAuth Application** and give it any name, for example "ReqTrac".
3. The callback URL is not used. Leave it empty, or enter `http://localhost` if osu! asks for one.
4. Paste the **Client ID** and **Client Secret** into the first-run setup or **Settings** → **osu! connection**. ReqTrac checks them with osu! before saving.
5. Optionally enter your osu! username so ReqTrac can recognise your own guest difficulties and leave you out of your requester rankings.

Without the osu! API you can still track requests by hand.

The application uses osu! as an external service. API availability, rate limits, returned data, and account access are controlled by osu! and its API policies. ReqTrac paces its calls at osu!'s recommended rate of about one per second.

## Google Sheets Export

The application can publish a sanitized, read-only copy of osu!-linked request data to Google Drive as a Google Sheet.

To configure Google Sheets for a development build:

1. Create a project in Google Cloud Console.
2. Enable the Google Sheets API and Google Drive API.
3. Create an OAuth client for a desktop application.
4. Copy `backend/google-oauth.json.example` to `backend/google-oauth.json`.
5. Add the client ID to the configuration file.
6. Build and start osu!ReqTrac.
7. Open **Settings** → **Google Sheets** and connect Google Drive.

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

The parent directory also holds `window-state.json` (window size and position). Interface preferences such as theme, columns, and filters are stored in the database, so they are included in backups.

Use **Settings** → **Data and backups** to export or restore a `backup.json` file. Back up the database before reinstalling, changing versions, or restoring data.

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

Bug reports and feature suggestions are welcome through [GitHub Issues](https://github.com/SEApodEErman/osu-ReqTrac/issues). You can also contact me through the [Discord server](https://discord.gg/Z5VFCdkExJ).

## License and Trademark Notice

The original source code and original assets in this repository are licensed under the [MIT License](LICENSE).

osu!ReqTrac is an independent, community-developed application and is not affiliated with, endorsed by, or sponsored by osu! or ppy Pty Ltd. The names osu!, ppy, related logos, visual identity, website content, user content, and other branding remain the property of their respective owners. See the [osu! brand identity guidelines](https://osu.ppy.sh/wiki/en/Brand_identity_guidelines) for appropriate use of osu!-related marks.

This application uses the [osu! API](https://osu.ppy.sh/docs/) as an external service. Users are responsible for complying with the [osu! Terms of Use](https://osu.ppy.sh/legal/en/Terms), API documentation, rate limits, and other applicable usage restrictions.

## Credits

- Vibe coded using the following tools: [Google's Antigravity](https://antigravity.google/), [OpenAI's Codex](https://chatgpt.com/codex/), and [OpenCode Zen](https://opencode.ai/zen).
- osu! API: <https://osu.ppy.sh/docs/index.html>
- Icons: [lucide-react](https://lucide.dev/)
- Built with Electron, React, Vite, Express, and SQLite.
