# Agent Guidance

## Structure

- The root package orchestrates the Electron app. `electron/main.js` starts the backend in production and loads the renderer; `backend/src/index.js` is the Express entrypoint and `frontend/src/main.jsx` is the React entrypoint.
- Development runs three processes: backend on `3001`, Vite frontend on `3000`, and Electron. Vite proxies `/api` and `/uploads` to the backend.
- SQLite data is persistent application state: standalone runs use `backend/data/`, while Electron runs use the Electron user-data directory. Schema creation and lightweight migrations live in `backend/src/db.js`.

## Commands

- Use Node.js 24.x and npm 10+; install all packages with `npm run install:all`.
- Run the app with `npm run dev`. The root script starts the backend, frontend, and Electron in the required order.
- Run backend tests with `npm test --prefix backend`; focus a test file with `npm test --prefix backend -- test/requestUtils.test.js` or a test name with `npm test --prefix backend -- --test-name-pattern="pattern"`.
- Build the renderer with `npm run build:frontend`; this also regenerates `build/icon.png`, `build/icon.ico`, and `build/icon.icns` from `build/icon.svg`.
- Package with `npm run build` or create an unpacked package with `npm run build:dir`; both build the renderer first. `frontend/dist/` and `release/` are generated output.

## Configuration And Releases

- Backend environment loading reads `backend/.env` (not the root `.env`). Supported local overrides include `PORT`, `FRONTEND_URL`, `OSU_REDIRECT_URI`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`.
- `backend/google-oauth.json` is gitignored and may be created from `backend/google-oauth.json.example`; never commit OAuth credentials or local `.env` files.
- Do not replace or ignore the top-level `build/` directory: its icon resources are committed and used by Electron Builder.
- A release is triggered by pushing a `v*` tag. CI uses Node 24, installs the root and frontend lockfiles, creates `backend/google-oauth.json` from GitHub secrets, and publishes platform installers.

## Verification

- The current automated suite is the backend Node test suite, with coverage centered on `backend/test/requestUtils.test.js`; it does not validate the Electron shell or full API flows.
- If changing a persistent database schema, add or update the migration logic in `backend/src/db.js` rather than relying only on a fresh database.
