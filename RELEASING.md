# Releasing osu!ReqTrac

This project ships as a desktop app (Electron) with installers published to
GitHub Releases. Builds are produced automatically by GitHub Actions for
Windows, macOS, and Linux, and the app auto-updates from those releases.

## One-time setup

1. Create the GitHub repo `seapodeerman/osu-ReqTrac` (must match the `publish`
   config in `package.json`).
2. Add the remote and push the code:

   ```sh
   git remote add origin https://github.com/seapodeerman/osu-ReqTrac.git
   git push -u origin main
   ```

No extra secrets are required: the release workflow uses the built-in
`GITHUB_TOKEN`.

## Cutting a release

1. Bump the version (this is what testers see and what auto-update compares):

   ```sh
   npm version patch   # or: minor / major
   ```

   `npm version` updates `package.json` and creates a `vX.Y.Z` git commit + tag.

2. Push the commit and the tag:

   ```sh
   git push
   git push --tags
   ```

3. The `Release` workflow (`.github/workflows/release.yml`) triggers on the
   `v*` tag, builds on all three OSes, and publishes a **draft** GitHub Release
   with the installers attached.

4. Go to the repo's Releases page, review, and click **Publish release**.
   Once published, existing installed apps will auto-update on next launch.

## Testers just download

Point testers at the Releases page:
`https://github.com/seapodeerman/osu-ReqTrac/releases/latest`

- Windows: `osu!ReqTrac-<version>-Setup.exe`
- macOS: `osu!ReqTrac-<version>.dmg`
- Linux: `osu!ReqTrac-<version>.AppImage`

### osu! API credentials

Beatmap syncing requires osu! OAuth credentials. Each tester registers their
own osu! OAuth application at <https://osu.ppy.sh/home/account/edit> (OAuth
section) and enters the Client ID / Secret on the in-app **Settings** page.
No credentials are bundled in the build.

## Building locally (optional)

- `npm run build:dir` — packages an unpacked app into `release/win-unpacked`
  (fast smoke test, no installer).
- `npm run build` — produces an installer for the current OS.

> On Windows, creating the installer may fail with a symlink privilege error
> unless **Developer Mode** is enabled (Settings -> Privacy & security -> For
> developers) or the terminal is run as Administrator. This does not affect the
> GitHub Actions builds.

## App data location

User data (SQLite DB + cached covers) lives outside the app so updates and
reinstalls don't wipe it:

- Windows: `%APPDATA%\osu!ReqTrac\data\`
- macOS: `~/Library/Application Support/osu!ReqTrac/data/`
- Linux: `~/.config/osu!ReqTrac/data/`
