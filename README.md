
<h1  align="center">osu!ReqTrac</h1>
<p  align="center"><img src="https://seapodeerman.s-ul.eu/JJN07d3w" width="200" align="center"><p>

<p  align="center"> A cross-platform desktop application for tracking and managing osu! requests.<p>

---

  

## Features

  

-  **Request Management** — Create, track, and organize beatmap requests with statuses (Accepted, Working, Completed, Cancelled), priorities, deadlines, and notes

-  **Categories & Tags** — Assign categories and custom tags to each request for easy filtering

-  **osu! Integration** — Connect your osu! account via OAuth to sync beatmap metadata, covers, and difficulties automatically

-  **Beatmap Caching** — Cached beatmap data (artist, title, creator, cover art, difficulties) stored locally for offline access

-  **Dashboard & Stats** — Overview of request statistics, status distribution, and workload

-  **Bulk Operations** — Update status or delete multiple requests at once

-  **Migration Support** — Migrate by pasting multiple links or backup/restore your database

-  **Auto-Updates** — Automatic updates via GitHub Releases (Electron Updater)

-  **Cross-Platform** — Windows, macOS, and Linux (AppImage)

-  **Local-First Data** — SQLite database stored in your user data directory (persists across updates)

- **Google Sheets Integration** - Allows syncing to a public viewable Google Sheets that are automatically formatted using Google's OAuth.


Since this project is still actively being worked on, feel free to open up issues for suggestions or bug reports. Or, if Discord is your preferred way of communication, you may contact me on my [discord server](https://discord.gg/Z5VFCdkExJ).

  

---

  

## Screenshots

<p  align="center">  <img  src="https://seapodeerman.s-ul.eu/2gedAQwX"  alt="Dashboard"  width="33%"  />  <img  src="https://seapodeerman.s-ul.eu/N3Sb3dLH"  alt="Dashboard"  width="33%"  />  <img  src="https://seapodeerman.s-ul.eu/PnSqVxXp"  alt="Settings"  width="33%"  />  
</p>
---

  

## Quick Start (User)
1. Grab the appropriate package for your operating systems under [releases](https://github.com/SEApodEErman/osu-ReqTrac/releases)
2. Open the app and fill in the credentials as prompted.
3. Start adding and organizing your requests!


## Quick Start (Development)

  

### Prerequisites

  

-  **Node.js** ≥ 20 (LTS recommended)

-  **npm** ≥ 10 (bundled with Node.js)

-  **Git**

  

### Install & Run

  

```bash

# Clone the repository

git  clone  https://github.com/seapodeerman/osu-ReqTrac.git

cd  osu-ReqTrac

  

# Install all dependencies (root, backend, frontend)

npm  run  install:all

  

# Start all three processes concurrently:

# - Backend API (Express + SQLite) on http://localhost:3001

# - Frontend dev server (Vite + React) on http://localhost:3000

# - Electron app (loads Vite dev server)

npm  run  dev

```

  

### osu! OAuth Credentials (Optional but Recommended)

  

To enable beatmap syncing and cover art caching:

  

1. Go to <https://osu.ppy.sh/home/account/edit> → **OAuth** → **New Application**

2. Set **Redirect URI** to whatever you want.

3. Copy **Client ID** and **Client Secret**

4. In the app, open **Settings** → enter your credentials → **Save**

  

> Credentials are stored locally in your SQLite database (encrypted at rest via SQLite). They are **never** bundled in the build or sent anywhere except osu!.ppy.sh.

## Building & Distribution

### Google Sheets public table

The desktop app can publish a sanitized, read-only copy of a table to the
user's Google Drive. The resulting Google Sheets link can be placed on an osu!
profile. ReqTrac does not host the published table or receive the user's
Google data.

To enable this for a packaged build:

1. Create a project in Google Cloud Console and enable the Google Sheets API
   and Google Drive API.
2. Create an OAuth client of type **Desktop app**.
3. Copy `backend/google-oauth.json.example` to `backend/google-oauth.json` and
   put your client ID in the `clientId` field. The client secret is optional
   for the PKCE desktop flow.
4. Build ReqTrac. The configuration file is bundled into the installer.
5. Start ReqTrac and open Settings → Public Google Sheet.
6. Connect Google Drive, then click Publish Sheet or Sync Sheet.

For development, `GOOGLE_CLIENT_ID` and the optional
`GOOGLE_CLIENT_SECRET` environment variables are also supported in
`backend/.env`. End users do not enter either value; they only authorize their
own Google account in the browser.

The export includes osu!-linked request metadata, categories, tags, statuses,
dates, and osu! links. Manual/non-osu entries are intentionally excluded from
the public sheet because they may represent unreleased maps. The export also
excludes private notes, Discord links, settings, OAuth credentials, and
database internals. The Drive file is shared as
`anyone with the link: Viewer`; disconnecting ReqTrac removes the local OAuth
tokens but does not delete the existing sheet from Google Drive. Packaged
desktop builds use PKCE, and Electron encrypts stored Google tokens with the
operating system credential store when available.

**Quick local build:**

  

```bash

npm  run  build  # Creates installer in release/

npm  run  build:dir  # Unpacked app in release/win-unpacked (or mac/linux equivalent)

```

  

### Output Locations

  
| Platform | Artifact |
|--|--|
| Windows | `release/osu!ReqTrac-<version>-Setup.exe` (NSIS) |
| macOS | `release/osu!ReqTrac-<version>.dmg` / `.zip` |
| Linux | `release/osu!ReqTrac-<version>.AppImage` |  

### User Data Directory (persists across updates)

  
| OS |Path  |
|--|--|
| Windows  | `%APPDATA%\osu!ReqTrac\data\` |
| macOS | `~/Library/Application Support/osu!ReqTrac/data/` |
| Linux | `~/.config/osu!ReqTrac/data/` |

Contains:

-  `database.sqlite` — all requests, categories, tags, history, settings

-  `covers/` — cached beatmap cover images  

## Contributing

  

1. Fork the repository

2. Create a feature branch: `git checkout -b feature/my-feature`

3. Make your changes

4. Run `npm run lint` (if configured) and ensure `npm run dev` works

5. Open a Pull Request

  

---

  

## License

  

The original source code and original assets in this repository are licensed

under the [MIT License](LICENSE).

  

### osu! trademark, branding, and API notice

  

This project is an independent, community-developed application and is not

affiliated with, endorsed by, or sponsored by osu! or ppy Pty Ltd. The names

osu!, ppy, and related logos, marks, visual identity, website content, user

content, and other branding are not covered by this repository's MIT License

and remain the property of their respective owners. Use of osu!-related marks

and branding should follow the [osu! brand identity guidelines](https://osu.ppy.sh/wiki/en/Brand_identity_guidelines).

  

This application uses the [osu! API](https://osu.ppy.sh/docs/) as an external

service. API access, OAuth credentials, returned data, and osu! website or

user content are not licensed under this repository's MIT License. Users are

responsible for complying with the [osu! Terms of Use](https://osu.ppy.sh/legal/en/Terms)

and the API documentation, including its request-rate guidance and applicable

usage restrictions.

  

---

  

## Credits

  

- Vibe coded by **seapodeerman** using  the following tools : [Google's Antigravity](https://antigravity.google/) [OpenAI's Codex](https://chatgpt.com/codex/) [OpenCode Zen](https://opencode.ai/zen)

- osu! API: <https://osu.ppy.sh/docs/index.html>

- Icons: [lucide-react](https://lucide.dev/)

- Electron, React, Vite, Express, SQLite communities
