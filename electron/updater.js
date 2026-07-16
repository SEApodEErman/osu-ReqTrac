const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');

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

  autoUpdater.on('update-downloaded', async (info) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'Restart the app to apply the update.',
    });
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  // Check on startup; electron-updater safely skips when not packaged.
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('Update check failed:', err && err.message ? err.message : err);
  });
}

module.exports = { initAutoUpdater };
