const express = require('express');
const router = express.Router();
const { getDatabase, coversDir, BUILTIN_CATEGORIES } = require('../db');
const { getCredentials, fetchBeatmapset, fetchUser, clearAccessToken, verifyCredentials } = require('../osuApi');
const { parseOsuUserLink } = require('../utils/requestUtils');
const { consumeState, issueState } = require('../utils/oauthState');
const { acquireBackupLock } = require('../utils/backupLock');
const { waitForBackgroundTasks } = require('../utils/backgroundTasks');
const { pauseMetadataSyncWorker, initializeMetadataSyncWorker } = require('../services/beatmapMetadataSync');
const { getCoverStorageUsage, readCoverFiles, writeCoverFiles } = require('../utils/backup');

const PREFERENCES_KEY = 'ui_preferences';
const MAX_PREFERENCES_BYTES = 64 * 1024;

async function readPreferences(db) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', PREFERENCES_KEY);
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Accepts a numeric osu! user ID, a profile URL, or a username.
function parseUserIdentityInput(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const profileId = parseOsuUserLink(text);
  if (profileId) return { id: profileId };
  if (/^\d+$/.test(text)) return { id: Number(text) };
  return { username: text.replace(/^@/, '') };
}

async function saveConnectedUser(db, identity) {
  if (!identity) {
    await db.run('DELETE FROM settings WHERE key IN (?, ?, ?)', 'connected_user_id', 'connected_username', 'connected_avatar');
    return { connected: false };
  }

  let userData = null;
  let lookupError = null;
  try {
    userData = await fetchUser(identity.id ? String(identity.id) : identity.username);
  } catch (error) {
    lookupError = error;
  }

  if (!userData) {
    if (identity.id && lookupError) {
      // Keep the ID even when the profile lookup is unavailable; it is enough
      // for guest-difficulty matching on the next request refresh.
      console.warn('Could not resolve connected osu! user:', lookupError.message);
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'connected_user_id', String(identity.id));
      await db.run('DELETE FROM settings WHERE key IN (?, ?)', 'connected_username', 'connected_avatar');
      return { connected: true, verified: false };
    }
    const error = new Error(lookupError
      ? 'Usernames can only be looked up once your osu! API credentials work. Enter your numeric user ID or profile link instead.'
      : `No osu! user was found for “${identity.username || identity.id}”.`);
    error.status = lookupError ? 400 : 404;
    throw error;
  }

  await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'connected_user_id', String(userData.id));
  await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'connected_username', userData.username);
  await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'connected_avatar', userData.avatar_url || '');
  return { connected: true, verified: true, username: userData.username };
}

// Get redirect URI from environment or use default
function getRedirectUri() {
  return process.env.OSU_REDIRECT_URI || 'http://localhost:3001/api/settings/oauth-callback';
}

// GET /api/settings - retrieve credentials state and connected account
router.get('/', async (req, res, next) => {
  try {
    const db = await getDatabase();
    
    // Retrieve connected account details (if any)
    const usernameRow = await db.get('SELECT value FROM settings WHERE key = ?', 'connected_username');
    const avatarRow = await db.get('SELECT value FROM settings WHERE key = ?', 'connected_avatar');
    const userIdRow = await db.get('SELECT value FROM settings WHERE key = ?', 'connected_user_id');

    const credentials = await getCredentials();
    const isConfigured = !!(credentials.client_id && credentials.client_secret);

    res.json({
      isConfigured,
      clientId: credentials.client_id ? '********' : null,
      userId: userIdRow ? userIdRow.value : null,
      connectedAccount: userIdRow ? {
        username: usernameRow ? usernameRow.value : `osu! user #${userIdRow.value}`,
        avatar: avatarRow ? avatarRow.value : null,
        id: userIdRow ? parseInt(userIdRow.value, 10) : null
      } : null,
      oauthConfigured: isConfigured,
      redirectUri: getRedirectUri(),
      preferences: await readPreferences(db)
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/data-usage - retrieve downloaded cover cache size
router.get('/data-usage', async (req, res, next) => {
  try {
    const { bytes, fileCount } = await getCoverStorageUsage(coversDir);
    res.json({ coverCacheBytes: bytes, coverCount: fileCount });
  } catch (error) {
    next(error);
  }
});

// POST /api/settings - configure client credentials
router.post('/', async (req, res, next) => {
  try {
    const { client_id, client_secret, user_id, user } = req.body;
    const db = await getDatabase();

    if (client_id !== undefined) {
      const normalizedClientId = client_id.toString().trim();
      if (normalizedClientId && !/^\d+$/.test(normalizedClientId)) {
        return res.status(400).json({ error: 'The osu! Client ID must be numeric.' });
      }
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'osu_client_id', normalizedClientId);
    }
    if (client_secret !== undefined) {
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'osu_client_secret', client_secret.toString().trim());
    }
    if (client_id !== undefined || client_secret !== undefined) {
      clearAccessToken();
      // Maps that failed to sync before osu! was set up get another try.
      const { retryFailedMetadata } = require('../services/beatmapMetadataSync');
      await retryFailedMetadata(db).catch(error => console.warn('Could not retry failed metadata:', error.message));
    }

    let account = null;
    if (user !== undefined) {
      account = await saveConnectedUser(db, parseUserIdentityInput(user));
    } else if (user_id !== undefined) {
      const normalizedUserId = user_id.toString().trim();
      if (normalizedUserId && !/^\d+$/.test(normalizedUserId)) {
        return res.status(400).json({ error: 'osu! User ID must be numeric.' });
      }
      account = await saveConnectedUser(db, normalizedUserId ? { id: Number(normalizedUserId) } : null);
    }

    res.json({ success: true, message: 'Settings saved successfully', account });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

// POST /api/settings/test-credentials - verify osu! OAuth credentials with osu!
// Omitted fields fall back to the stored values so a saved setup can be re-tested.
router.post('/test-credentials', async (req, res, next) => {
  try {
    const stored = await getCredentials();
    const clientId = String(req.body?.client_id ?? '').trim() || stored.client_id;
    const clientSecret = String(req.body?.client_secret ?? '').trim() || stored.client_secret;
    const result = await verifyCredentials(clientId, clientSecret);
    res.status(result.ok ? 200 : 422).json(result);
  } catch (error) {
    next(error);
  }
});

// GET/PATCH /api/settings/preferences - renderer preferences (theme, columns,
// filters). Stored in SQLite because the packaged renderer origin is not a
// stable home for localStorage, and so preferences travel with backups.
router.get('/preferences', async (req, res, next) => {
  try {
    res.json(await readPreferences(await getDatabase()));
  } catch (error) {
    next(error);
  }
});

router.patch('/preferences', async (req, res, next) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'Preferences must be a JSON object.' });
    }
    const db = await getDatabase();
    const merged = { ...(await readPreferences(db)) };
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    const serialized = JSON.stringify(merged);
    if (Buffer.byteLength(serialized) > MAX_PREFERENCES_BYTES) {
      return res.status(413).json({ error: 'Preferences are too large to store.' });
    }
    await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', PREFERENCES_KEY, serialized);
    res.json(merged);
  } catch (error) {
    next(error);
  }
});

// POST /api/settings/disconnect - disconnect osu! account
router.post('/disconnect', async (req, res, next) => {
  try {
    const db = await getDatabase();
    await db.run('DELETE FROM settings WHERE key IN (?, ?, ?)', 'connected_username', 'connected_avatar', 'connected_user_id');
    res.json({ success: true, message: 'Disconnected successfully' });
  } catch (error) {
    next(error);
  }
});

// POST /api/settings/delete-all-data - permanently clear all local application data
router.post('/delete-all-data', async (req, res, next) => {
  let db;
  let transactionStarted = false;
  let resetCommitted = false;
  let releaseBackupLock;
  let originalCoverFiles;
  let coverFilesModified = false;

  try {
    releaseBackupLock = await acquireBackupLock();
    await waitForBackgroundTasks();
    db = await getDatabase();
    await pauseMetadataSyncWorker();
    originalCoverFiles = await readCoverFiles(coversDir);

    await db.exec('BEGIN TRANSACTION');
    transactionStarted = true;

    // Delete child tables before requests/tags while foreign-key enforcement is on.
    for (const table of [
      'request_categories',
      'request_guest_difficulties',
      'request_tags',
      'history',
      'requests',
      'beatmap_cache',
      'beatmap_metadata_sync',
      'user_username_history',
      'unavailable_osu_users',
      'users_cache',
      'tags',
      'settings'
    ]) {
      await db.run(`DELETE FROM ${table}`);
    }
    await db.run('DELETE FROM categories WHERE system_key IS NULL');
    for (const [name, systemKey, viewType, sortOrder] of BUILTIN_CATEGORIES) {
      await db.run(`
        UPDATE categories SET name = ?, view_type = ?, sort_order = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP
        WHERE system_key = ?
      `, name, viewType, sortOrder, systemKey);
    }
    await db.run('DELETE FROM sqlite_sequence');

    // Keep the default cover asset, but remove all downloaded cover images.
    coverFilesModified = true;
    await writeCoverFiles(coversDir, []);

    await db.exec('COMMIT');
    transactionStarted = false;
    resetCommitted = true;
    clearAccessToken();
    await db.run('PRAGMA foreign_keys = ON');
    await initializeMetadataSyncWorker();

    res.json({ success: true, message: 'All local application data was deleted.' });
  } catch (error) {
    if (db && transactionStarted) {
      await db.exec('ROLLBACK').catch(() => {});
    }
    if (!resetCommitted && coverFilesModified && originalCoverFiles) {
      await writeCoverFiles(coversDir, originalCoverFiles).catch(restoreError => {
        console.error('[settings] Failed to restore cover files after data deletion error:', restoreError.message);
      });
    }
    if (db) {
      await db.run('PRAGMA foreign_keys = ON').catch(() => {});
      await initializeMetadataSyncWorker().catch(recoveryError => {
        console.error('[settings] Failed to restart metadata sync worker:', recoveryError.message);
      });
    }
    next(error);
  } finally {
    releaseBackupLock?.();
  }
});

// GET /api/settings/oauth-url - generate OAuth URL for user authentication
router.get('/oauth-url', async (req, res, next) => {
  try {
    const { client_id } = await getCredentials();
    if (!client_id) {
      return res.status(400).json({ error: 'osu! Client ID not configured.' });
    }

    const redirectUri = getRedirectUri();
    const state = issueState();
    const oauthUrl = `https://osu.ppy.sh/oauth/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify&state=${state}`;

    res.json({ url: oauthUrl });
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/oauth-callback - handle callback from osu! OAuth redirect
router.get('/oauth-callback', async (req, res, next) => {
  const { code, state, error: oauthError, error_description: oauthErrorDesc } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  // Reject callbacks that do not correspond to an authorization this app
  // started (login-CSRF protection). osu! echoes the state back on both
  // success and error redirects, so legitimate flows always carry it.
  if (!consumeState(state)) {
    return res.redirect(`${frontendUrl}/settings?oauth_error=invalid_state&error_desc=${encodeURIComponent('The OAuth state parameter is missing, expired, or already used. Start the connection again from osu!ReqTrac.')}`);
  }

  // Handle OAuth errors from osu! (e.g., user denied access)
  if (oauthError) {
    console.error('OAuth error from osu!:', oauthError, oauthErrorDesc);
    return res.redirect(`${frontendUrl}/settings?oauth_error=${encodeURIComponent(oauthError)}&error_desc=${encodeURIComponent(oauthErrorDesc || '')}`);
  }

  if (!code) {
    return res.status(400).send('Authorization code missing.');
  }

  try {
    const { client_id, client_secret } = await getCredentials();
    
    if (!client_id || !client_secret) {
      return res.status(500).send('osu! API credentials not configured on server.');
    }

    const redirectUri = getRedirectUri();

    // Exchange code for token
    const tokenRes = await fetch('https://osu.ppy.sh/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: parseInt(client_id, 10),
        client_secret: client_secret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      })
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error('Token exchange failed:', tokenData);
      const errorMsg = tokenData.error_description || tokenData.message || JSON.stringify(tokenData);
      return res.redirect(`${frontendUrl}/settings?oauth_error=token_exchange&error_desc=${encodeURIComponent(errorMsg)}`);
    }

    const userAccessToken = tokenData.access_token;

    // Fetch user details
    const userRes = await fetch('https://osu.ppy.sh/api/v2/me', {
      headers: {
        'Authorization': `Bearer ${userAccessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!userRes.ok) {
      const errText = await userRes.text();
      console.error('Failed to fetch user profile:', errText);
      return res.redirect(`${frontendUrl}/settings?oauth_error=user_fetch&error_desc=${encodeURIComponent(errText)}`);
    }

    const userData = await userRes.json();
    
    // Save to settings
    const db = await getDatabase();
    await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'connected_username', userData.username);
    await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'connected_avatar', userData.avatar_url);
    await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'connected_user_id', userData.id.toString());

    // Redirect user back to frontend dashboard
    res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000');
  } catch (error) {
    console.error('OAuth Callback Error:', error);
    res.redirect(`${frontendUrl}/settings?oauth_error=server_error&error_desc=${encodeURIComponent(error.message)}`);
  }
});

// GET /api/settings/oauth-validate - validate OAuth configuration
router.get('/oauth-validate', async (req, res, next) => {
  try {
    const { client_id, client_secret } = await getCredentials();
    const redirectUri = getRedirectUri();

    const issues = [];
    
    if (!client_id) {
      issues.push('Client ID is not configured');
    } else if (!/^\d+$/.test(client_id)) {
      issues.push('Client ID must be a numeric value');
    }
    
    if (!client_secret) {
      issues.push('Client Secret is not configured');
    }

    // Validate redirect URI format
    try {
      new URL(redirectUri);
    } catch {
      issues.push('Invalid redirect URI format');
    }

    // Check if redirect URI uses HTTPS for production
    if (redirectUri.startsWith('https://') && !redirectUri.includes('localhost')) {
      // Good - production should use HTTPS
    } else if (redirectUri.startsWith('http://') && !redirectUri.includes('localhost')) {
      issues.push('Production redirect URI should use HTTPS');
    }

    res.json({
      valid: issues.length === 0,
      issues,
      redirectUri,
      clientIdConfigured: !!client_id,
      clientSecretConfigured: !!client_secret
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.testUtils = { parseUserIdentityInput, readPreferences };
