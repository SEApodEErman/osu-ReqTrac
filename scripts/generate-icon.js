const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');
const { appBuilderPath } = require('app-builder-bin');

const root = path.resolve(__dirname, '..');
const input = path.join(root, 'build', 'icon.svg');
const png = path.join(root, 'build', 'icon.png');
const ico = path.join(root, 'build', 'icon.ico');
const icns = path.join(root, 'build', 'icon.icns');

if (!fs.existsSync(input)) {
  throw new Error(`Icon source not found: ${input}`);
}

async function main() {
  const generatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-reqtrac-icons-'));

  await sharp(input)
    .resize(1024, 1024)
    .png()
    .toFile(png);

  try {
    for (const [format, output] of [['ico', ico], ['icns', icns]]) {
      const outputDirectory = path.join(generatedRoot, format);
      execFileSync(appBuilderPath, [
        'icon',
        `--input=${png}`,
        `--format=${format}`,
        `--out=${outputDirectory}`,
      ], { stdio: 'inherit' });
      const generatedFile = path.join(outputDirectory, path.basename(output));
      fs.rmSync(output, { recursive: true, force: true });
      fs.copyFileSync(generatedFile, output);
    }
  } finally {
    fs.rmSync(generatedRoot, { recursive: true, force: true });
  }

  console.log('Generated build/icon.png, build/icon.ico, and build/icon.icns from build/icon.svg');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
