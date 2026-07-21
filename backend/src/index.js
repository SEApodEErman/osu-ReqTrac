const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDatabase, coversDir } = require('./db');
const { waitForBackupUnlock } = require('./utils/backupLock');

// Load local backend/.env when running outside a process manager.
try {
  process.loadEnvFile?.(path.resolve(__dirname, '../.env'));
} catch (error) {
  console.warn('[env] Could not load backend/.env:', error.message);
}

const app = express();
const isElectron = process.env.ELECTRON_RUN === '1';
const REQUEST_BODY_LIMIT = '50mb';
// In Electron production we bind to an OS-assigned free port (0) to avoid conflicts.
// In standalone/dev we keep the fixed port for the Vite proxy.
const PORT = process.env.PORT || (isElectron ? 0 : 3001);

// CORS setup — allow both Vite dev server and Electron file:// protocol
const corsOrigin = process.env.ELECTRON_RUN === '1'
  ? true
  : (process.env.FRONTEND_URL || 'http://localhost:3000');

app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: REQUEST_BODY_LIMIT }));
app.use(waitForBackupUnlock);

// Serve cover images statically from the SQLite data folder
app.use('/uploads/covers', express.static(coversDir));

// Also serve default cover image if cached cover doesn't exist
app.get('/uploads/covers/default.jpg', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'assets/default_cover.jpg'));
});

// Import routes
const requestsRouter = require('./routes/requests');
const { router: beatmapsRouter } = require('./routes/beatmaps');
const statsRouter = require('./routes/stats');
const migrationRouter = require('./routes/migration');
const settingsRouter = require('./routes/settings');
const osuRouter = require('./routes/osu');
const googleSheetsRouter = require('./routes/googleSheets');
const categoriesRouter = require('./routes/categories');
const tagsRouter = require('./routes/tags');

// Mount routes
app.use('/api/requests', requestsRouter);
app.use('/api/beatmaps', beatmapsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/migration', migrationRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/osu', osuRouter);
app.use('/api/google', googleSheetsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/tags', tagsRouter);

// Basic health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// In Electron/production, serve the built frontend so relative /api and /uploads
// URLs resolve against this same origin (http://localhost:<port>).
if (isElectron && process.env.FRONTEND_DIST) {
  const frontendDist = process.env.FRONTEND_DIST;
  app.use(express.static(frontendDist));
  // SPA fallback: any non-API GET returns index.html
  app.get(/^(?!\/api|\/uploads).*/, (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: `Request payload exceeds the ${REQUEST_BODY_LIMIT} limit.` });
  }
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// Create default cover assets folder and placeholder if not exists
const assetsDir = path.resolve(__dirname, 'assets');
if (!fsExistsSync(assetsDir)) {
  fsMkdirSync(assetsDir);
}
// Generate simple default cover programmatically or create text file
const defaultCoverPath = path.resolve(assetsDir, 'default_cover.jpg');
if (!fsExistsSync(defaultCoverPath)) {
  // We'll write a simple 1x1 black pixel or use placeholder text
  // Since we'll have a placeholder fallback in the UI, a tiny stub is fine
  const pixel64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  fsWriteFileSync(defaultCoverPath, Buffer.from(pixel64, 'base64'));
}

function fsExistsSync(p) {
  try {
    const fs = require('fs');
    return fs.existsSync(p);
  } catch (e) {
    return false;
  }
}

function fsMkdirSync(p) {
  const fs = require('fs');
  fs.mkdirSync(p, { recursive: true });
}

function fsWriteFileSync(p, c) {
  const fs = require('fs');
  fs.writeFileSync(p, c);
}

// Start database and server. Resolves with the actual bound port so the
// Electron main process can point the window at the right URL.
async function startServer() {
  await getDatabase();
  const { initializeMetadataSyncWorker } = require('./services/beatmapMetadataSync');
  await initializeMetadataSyncWorker();
  const { refreshKnownCreatorIdentities } = require('./routes/beatmaps');
  const { trackBackgroundTask } = require('./utils/backgroundTasks');
  trackBackgroundTask(refreshKnownCreatorIdentities(await getDatabase()).catch(error => {
    console.error('[user-identities] Background refresh failed:', error.message);
  }));
  console.log('Database initialized successfully.');

  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, '127.0.0.1', () => {
      const actualPort = server.address().port;
      console.log(`Server is running on port ${actualPort}`);
      resolve(actualPort);
    });
    server.on('error', reject);
    // Prevent connection timeouts during long beatmap-link imports and API syncs.
    server.timeout = 0;
    server.keepAliveTimeout = 300000;
  });
}

module.exports = { startServer, app };

// When run standalone (node src/index.js) start immediately.
// When imported by Electron, the main process calls startServer() itself.
if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to initialize database and start server:', error);
    process.exit(1);
  });
}
