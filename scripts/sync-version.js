// Keeps every manifest version in sync with the ROOT package.json during
// `npm version <x.y.z>` (the single command that names a release).
//
// npm bumps root package.json first, then runs this "version" lifecycle
// script: we propagate the version to backend/ and frontend/ manifests (and
// their lockfiles), and stage them so they land in the same version commit
// npm creates alongside the vX.Y.Z tag.
//
// Manual use is safe and idempotent: `node scripts/sync-version.js`.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const manifests = [
  'backend/package.json',
  'backend/package-lock.json',
  'frontend/package.json',
  'frontend/package-lock.json'
];

for (const manifest of manifests) {
  const file = path.join(root, manifest);
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.version = version;
  if (data.packages && data.packages['']) data.packages[''].version = version;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  execFileSync('git', ['add', manifest], { cwd: root });
}

console.log(`Synced version ${version} to backend/ and frontend/ manifests.`);
