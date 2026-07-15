require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDatabase, coversDir } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS setup
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Mount routes
app.use('/api/requests', requestsRouter);
app.use('/api/beatmaps', beatmapsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/migration', migrationRouter);
app.use('/api/settings', settingsRouter);

// Basic health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
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

// Start database and server
async function startServer() {
  try {
    await getDatabase();
    console.log('Database initialized successfully.');

    // Verify osu! OAuth credentials exist in environment variables
    const oauthClientId = process.env.OSU_CLIENT_ID;
    const oauthClientSecret = process.env.OSU_CLIENT_SECRET;
    if (!oauthClientId || !oauthClientSecret) {
      console.warn('\n[WARNING] osu! OAuth credentials are missing from environment variables (OSU_CLIENT_ID and/or OSU_CLIENT_SECRET).');
      console.warn('To enable beatmap syncing and account connection, please configure them in your backend/.env file or through the Settings page in the web UI.\n');
    }
    
    const server = app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
    // Prevent connection timeouts during long operations (CSV import, etc.)
    server.timeout = 0;
    server.keepAliveTimeout = 300000;
  } catch (error) {
    console.error('Failed to initialize database and start server:', error);
    process.exit(1);
  }
}

startServer();
