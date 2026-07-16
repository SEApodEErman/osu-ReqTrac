const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');

// Set a stable app name so userData resolves to a clean, consistent folder
app.setName('osu!ReqTrac');
// The default Electron menu is visually out of place for this desktop app.
// Navigation and actions are presented in the renderer's app-style top bar.
Menu.setApplicationMenu(null);

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

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('open-external', (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('Only HTTP(S) URLs can be opened externally.');
  }
  return shell.openExternal(url);
});

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
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

  // Keep external sites in the user's default browser instead of opening an
  // Electron child window, including links opened with target="_blank".
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (/^https?:\/\//i.test(url) && !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  if (isDev) {
    // Dev: Vite dev server (which proxies /api to the standalone backend on 3001)
    mainWindow.loadURL('http://localhost:3000');
    // mainWindow.webContents.openDevTools();
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
