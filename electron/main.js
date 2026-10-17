const { app, BrowserWindow, Menu, clipboard, ipcMain, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');

// Set a stable app name so userData resolves to a clean, consistent folder
app.setName('osu!ReqTrac');
// The default Electron menu is visually out of place for this desktop app.
// Navigation and actions are presented in the renderer's app-style top bar.
// macOS still needs an application menu: without the Edit roles, Cmd+C/V/X/A/Z
// and Cmd+Q stop working.
if (process.platform === 'darwin') {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
  ]));
} else {
  Menu.setApplicationMenu(null);
}

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
const { initAutoUpdater, installUpdate } = require('./updater');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

let mainWindow;
let backendPort;
let flashFrameTimer;

const APP_BACKGROUND = '#121016';
const DEFAULT_BOUNDS = { width: 1400, height: 900 };
const windowStatePath = () => path.join(app.getPath('userData'), 'window-state.json');

function readWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
    const bounds = state?.bounds;
    if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return null;
    // Only restore a position that is still visible on a connected display.
    const visible = screen.getAllDisplays().some(({ workArea }) => (
      bounds.x < workArea.x + workArea.width - 80 && bounds.x + bounds.width > workArea.x + 80
      && bounds.y >= workArea.y - 20 && bounds.y < workArea.y + workArea.height - 80
    ));
    return { bounds: visible ? bounds : { width: bounds.width, height: bounds.height }, isMaximized: Boolean(state.isMaximized) };
  } catch {
    return null;
  }
}

function trackWindowState(window) {
  let saveTimer = null;
  const save = () => {
    if (window.isDestroyed() || window.isMinimized()) return;
    const state = { bounds: window.isMaximized() ? window.getNormalBounds() : window.getBounds(), isMaximized: window.isMaximized() };
    try {
      fs.writeFileSync(windowStatePath(), JSON.stringify(state));
    } catch (error) {
      console.warn('Could not save window state:', error.message);
    }
  };
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  };
  window.on('resize', scheduleSave);
  window.on('move', scheduleSave);
  window.on('maximize', scheduleSave);
  window.on('unmaximize', scheduleSave);
  window.on('close', () => {
    clearTimeout(saveTimer);
    save();
  });
}

function escapeHtml(text) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return String(text).replace(/[&<>"]/g, character => entities[character]);
}

// Self-contained page shown while the local server starts, or when it fails.
function statusPage(title, message, { spinner = false, closable = false } = {}) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>osu!ReqTrac</title><style>
    html,body{margin:0;height:100%;background:${APP_BACKGROUND};color:#ece9f2;font:14px system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-app-region:drag}
    main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:24px;box-sizing:border-box}
    h1{margin:0;font-size:18px;font-weight:700}p{margin:0;max-width:520px;color:#9591a1;line-height:1.5;white-space:pre-wrap}
    .spinner{width:28px;height:28px;border-radius:50%;border:3px solid #302b3a;border-top-color:#ff66aa;animation:spin 0.9s linear infinite}
    button{-webkit-app-region:no-drag;margin-top:6px;padding:8px 16px;border:0;border-radius:8px;background:#ff66aa;color:#fff;font:inherit;font-weight:600;cursor:pointer}
    @keyframes spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion: reduce){.spinner{animation-duration:3s}}
  </style></head><body><main>${spinner ? '<div class="spinner"></div>' : ''}<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${closable ? '<button onclick="window.close()">Close osu!ReqTrac</button>' : ''}</main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function handleProtocolArguments(commandLine) {
  const callbackUrl = commandLine.find((argument) => argument.startsWith('osureqtrac://'));
  if (callbackUrl) focusMainWindow();
}

app.on('second-instance', (_event, commandLine) => {
  handleProtocolArguments(commandLine);
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url.startsWith('osureqtrac://')) focusMainWindow();
});

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
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:flash-frame', () => {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed() || mainWindow.isFocused()) return false;
  mainWindow.flashFrame(true);
  if (flashFrameTimer) clearTimeout(flashFrameTimer);
  flashFrameTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(false);
    flashFrameTimer = null;
  }, 5000);
  return true;
});
ipcMain.handle('update:install', () => installUpdate());
ipcMain.handle('clipboard:read-text', () => clipboard.readText());
ipcMain.handle('open-external', (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('Only HTTP(S) URLs can be opened externally.');
  }
  return shell.openExternal(url);
});

async function createWindow() {
  const savedState = readWindowState();
  mainWindow = new BrowserWindow({
    ...DEFAULT_BOUNDS,
    ...(savedState?.bounds || {}),
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    backgroundColor: APP_BACKGROUND,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../build/icon.png'),
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    if (savedState?.isMaximized) mainWindow.maximize();
    mainWindow.show();
  });
  trackWindowState(mainWindow);

  const sendMaximizedState = () => {
    if (!mainWindow?.isDestroyed()) {
      mainWindow.webContents.send('window:maximized-change', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', sendMaximizedState);
  mainWindow.on('unmaximize', sendMaximizedState);

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

  // Removing Electron's native menu also removes its normal reload and zoom
  // accelerators. Restore them for the focused app window only (macOS gets
  // them from its application menu instead).
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (process.platform === 'darwin' || input.type !== 'keyDown' || !(input.control || input.meta)) return;
    const key = input.key.toLowerCase();
    const contents = mainWindow.webContents;
    if (key === 'r') {
      event.preventDefault();
      mainWindow.reload();
    } else if (key === '=' || key === '+') {
      event.preventDefault();
      contents.setZoomLevel(Math.min(contents.getZoomLevel() + 0.5, 3));
    } else if (key === '-') {
      event.preventDefault();
      contents.setZoomLevel(Math.max(contents.getZoomLevel() - 0.5, -3));
    } else if (key === '0') {
      event.preventDefault();
      contents.setZoomLevel(0);
    }
  });

  // Show the window straight away with a loading screen while the local
  // server opens the database and runs migrations.
  await mainWindow.loadURL(statusPage('Starting osu!ReqTrac', 'Opening your request database…', { spinner: true }));
}

async function loadApplication() {
  if (isDev) {
    // Dev: Vite dev server (which proxies /api to the standalone backend on 3001)
    await mainWindow.loadURL('http://localhost:3000');
    return;
  }
  try {
    // Prod: the backend serves the built frontend on its own port,
    // so relative /api and /uploads URLs resolve correctly.
    backendPort ??= await startServer();
    await mainWindow.loadURL(`http://127.0.0.1:${backendPort}`);
  } catch (err) {
    console.error('Failed to start backend:', err);
    await mainWindow.loadURL(statusPage(
      'osu!ReqTrac could not start',
      `The local request database could not be opened.\n\n${err?.message || err}\n\nClose the app and try again. If this keeps happening, report it on GitHub with this message.`,
      { closable: true },
    ));
  }
}

app.whenReady().then(async () => {
  app.setAsDefaultProtocolClient('osureqtrac');
  await createWindow();
  await loadApplication();

  // Check for updates in production (no-op when unpackaged/dev).
  if (!isDev) {
    initAutoUpdater(mainWindow);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length > 0) return;
  await createWindow();
  await loadApplication();
});
