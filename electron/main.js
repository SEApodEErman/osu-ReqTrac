const { app, BrowserWindow } = require('electron');
const path = require('path');

// Set a stable app name so userData resolves to a clean, consistent folder
app.setName('osu!ReqTrac');

const isDev = process.env.NODE_ENV === 'development';

// Set env flag so backend can detect Electron
process.env.ELECTRON_RUN = '1';

// Tell the backend where the built frontend lives so it can serve it in prod.
// When packaged, files live under the app's resource path; unpacked, in repo.
if (!isDev) {
  process.env.FRONTEND_DIST = path.join(__dirname, '../frontend/dist');
}

// Import (do not auto-start) the backend; we start it and read the port.
const { startServer } = require('../backend/src/index');
const { initAutoUpdater } = require('./updater');

let mainWindow;
let backendPort;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../build/icon.png'),
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (isDev) {
    // Dev: Vite dev server (which proxies /api to the standalone backend on 3001)
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // Prod: the backend serves the built frontend on its own port,
    // so relative /api and /uploads URLs resolve correctly.
    mainWindow.loadURL(`http://127.0.0.1:${backendPort}`);
  }
}

app.whenReady().then(async () => {
  try {
    // In dev the standalone backend runs separately; don't double-start it.
    if (!isDev) {
      backendPort = await startServer();
    }
  } catch (err) {
    console.error('Failed to start backend:', err);
  }
  await createWindow();

  // Check for updates in production (no-op when unpackaged/dev).
  if (!isDev) {
    initAutoUpdater(mainWindow);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
