# Releasing

## Validate the changes

Review the working tree and current branch, run the backend and frontend tests, and build the renderer. Check changed UI flows in the actual app as needed.

Commit the intended changes before naming the release.

## Name the release

The root `package.json` version is the source of truth. From a clean working tree:

```sh
npm version 1.5.2
```

The version above is an example, not a release instruction. Use the intended next version.

The version lifecycle synchronizes root, backend, and frontend manifests and lockfiles, creates a version commit, and tags it `vX.Y.Z`. Frontend version text comes from the root version through Vite.

Build the renderer again after the bump to verify the release version.

## Push the intended tag

Inspect the remote branch and tags first. Push the release branch and the specific new tag together:

```sh
git push --atomic origin main refs/tags/v1.5.2
```

Replace the example version. Avoid a broad tag push: stale local tags can trigger unintended release workflows.

## CI and publication

`.github/workflows/release.yml` runs when a `v*` tag is pushed. It:

1. Verifies that the tag matches the root package version.
2. Uses Node.js 24 and installs root and frontend dependencies.
3. Builds the renderer and icon resources.
4. Creates `backend/google-oauth.json` from the `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` repository secrets.
5. Packages and uploads Windows, macOS, and Linux builds through Electron Builder.

Check all matrix jobs before publishing. With the current configuration, Electron Builder creates a draft release. Review its notes and assets, including the platform update manifests, then publish it as the intended stable or prerelease version.

CI is the packaging check. Successful CI and uploaded manifests do not replace an end-to-end installation or update test on each platform.
