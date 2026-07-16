const { autoUpdater } = require('electron-updater');

// Wires up auto-updates against the GitHub Releases published by electron-builder.
// Safe to call once the main window exists. No-ops in dev / unpackaged runs.
function initAutoUpdater(mainWindow) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err == null ? 'unknown' : err.message || err);
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`Update available: ${info.version}`);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('No updates available.');
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('update-downloaded', { version: info.version });
  });

  // Check on startup; electron-updater safely skips when not packaged.
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('Update check failed:', err && err.message ? err.message : err);
  });
}

function installUpdate() {
  autoUpdater.quitAndInstall();
}

module.exports = { initAutoUpdater, installUpdate };
