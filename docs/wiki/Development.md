# Development

## Requirements

- Node.js **24.x**.
- npm **10+**.
- Git.

## Install and run

```sh
git clone https://github.com/SEApodEErman/osu-ReqTrac.git
cd osu-ReqTrac
npm run install:all
npm run dev
```

The dev command starts the backend on port **3001**, Vite on **3000**, and Electron after both are ready. Vite proxies `/api` and `/uploads` to the backend.

Check that those ports are free before starting another copy. A separate Vite process may choose another port, while Electron still expects 3000.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev:backend` | Start only the backend |
| `npm run dev:frontend` | Start only Vite |
| `npm run build:frontend` | Generate icons and build the renderer |
| `npm run build` | Build platform packages |
| `npm run build:dir` | Build an unpacked app |
| `npm run generate:icon` | Regenerate the shared app icon assets |
| `npm test --prefix backend` | Run backend tests |
| `npm test --prefix frontend` | Run frontend utility tests |

Focus a backend test with `npm test --prefix backend -- test/requestUtils.test.js`.

The frontend has no lint or typecheck script. Its utility tests do not render components, so use the production build and browser or Electron checks for UI changes. A successful build alone does not prove every dialog renders correctly.

## Local configuration

The backend loads **`backend/.env`**, not the root `.env`. A normal dev run does not require a custom environment file.

Supported overrides include `PORT`, `FRONTEND_URL`, `OSU_REDIRECT_URI`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`. The default Vite proxy assumes backend port 3001.

osu! Client ID and Client Secret are saved through the app into SQLite. Despite the entries in `backend/.env.example`, `OSU_CLIENT_ID` and `OSU_CLIENT_SECRET` are not read from the environment.

The standard osu! setup uses public-data access and a username lookup. A separate backend OAuth authorization flow uses `OSU_REDIRECT_URI`, defaulting to `http://localhost:3001/api/settings/oauth-callback`; register the matching callback if developing that flow.

[Google Sheets](https://github.com/SEApodEErman/osu-ReqTrac/wiki/Google-Sheets) documents the developer OAuth configuration. Never commit `backend/.env`, `backend/google-oauth.json`, tokens, or local databases.

## Project layout

| Path | Responsibility |
| --- | --- |
| `electron/main.js` | Desktop window, backend startup, and production loading |
| `backend/src/index.js` | Express entrypoint |
| `backend/src/db.js` | Schema and idempotent startup migrations |
| `backend/src/utils/sqliteAdapter.js` | Promise shim around Node's built-in SQLite |
| `backend/src/osuApi.js` | osu! access, caching support, and API scheduling |
| `frontend/src/App.jsx` | React shell and navigation |
| `frontend/src/hooks/useAppData.js` | Data loading and refreshes |
| `frontend/src/hooks/useRequestActions.js` | Mutations and reconciliation |
| `build/icon.svg` | Canonical app logo |
| `docs/wiki/` | Sources for this wiki |

This is not an npm workspace. Backend runtime dependencies are declared in both the root and backend packages for packaged and standalone execution. Update both manifests and lockfiles when changing them.

Use the SQLite adapter rather than adding a native driver. Persistent schema changes need migrations for existing databases, not just fresh-schema changes.

All osu! calls go through `osuApi.js`. Label user-visible bulk jobs with `bulk` and upkeep with `background`; prefer batched map/user endpoints over one call per item.

## Icons and screenshots

Edit `build/icon.svg`, then run `npm run generate:icon`. It produces the Electron PNG/ICO/ICNS assets and synchronizes the renderer SVG and browser favicons.

The committed `build/` directory is required by Electron Builder. `frontend/dist/` and `release/` are generated output. `design/` is ignored concept artwork.

README screenshots live in `docs/screenshots/`. Capture them at **1600 × 900 (16:9)** and verify the saved image dimensions.

## Data and test safety

Development uses `backend/data/`; packaged Electron uses its user-data directory. Do not assume the two installations share requests or settings.

Use in-memory SQLite, temporary files, or a copy of a database for destructive tests. JSON restore and delete-all-data replace or remove existing tables. Do not test them against live user data.

## Contributing

Fork the project, create a feature branch, and make a focused change. Run checks appropriate to the affected code and open a pull request explaining the behavior and validation. Follow `AGENTS.md` for repository-specific guidance.

## Editing this wiki

Edit the source pages in `docs/wiki/`. GitHub stores the published wiki in a separate Git repository.

For example, from the app checkout in PowerShell:

```powershell
git clone https://github.com/SEApodEErman/osu-ReqTrac.wiki.git ../osu-ReqTrac.wiki
Copy-Item docs/wiki/*.md ../osu-ReqTrac.wiki/
git -C ../osu-ReqTrac.wiki diff
git -C ../osu-ReqTrac.wiki add --all
git -C ../osu-ReqTrac.wiki commit -m "Update documentation"
git -C ../osu-ReqTrac.wiki push
```

Use an existing wiki checkout instead of cloning again if one is already available. Commit the source changes in the application repository too; publishing the wiki does not commit them there.
