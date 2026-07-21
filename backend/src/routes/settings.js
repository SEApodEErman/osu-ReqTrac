const express = require('express');
const router = express.Router();
const { getDatabase, coversDir, BUILTIN_CATEGORIES } = require('../db');
const { getCredentials, fetchBeatmapset, fetchUser, clearAccessToken } = require('../osuApi');
const { acquireBackupLock } = require('../utils/backupLock');
const { waitForBackgroundTasks } = require('../utils/backgroundTasks');
const { pauseMetadataSyncWorker, initializeMetadataSyncWorker } = require('../services/beatmapMetadataSync');
const { getCoverStorageUsage, readCoverFiles, writeCoverFiles } = require('../utils/backup');

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
      redirectUri: getRedirectUri()
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
    const { client_id, client_secret, user_id } = req.body;
    const db = await getDatabase();

    if (client_id !== undefined) {
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'osu_client_id', client_id.toString().trim());
    }
    if (client_secret !== undefined) {
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'osu_client_secret', client_secret.toString().trim());
    }
    if (user_id !== undefined) {
      const normalizedUserId = user_id.toString().trim();
      if (normalizedUserId && !/^\d+$/.test(normalizedUserId)) {
        return res.status(400).json({ error: 'osu! User ID must be numeric.' });
      }
      if (normalizedUserId) {
        await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'connected_user_id', normalizedUserId);
        try {
          const userData = await fetchUser(normalizedUserId);
          if (userData) {
            await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'connected_username', userData.username);
            await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'connected_avatar', userData.avatar_url || '');
          }
        } catch (error) {
          // Keep the ID even when profile lookup is unavailable; it is enough
          // for guest-difficulty matching on the next request refresh.
          console.warn('Could not resolve connected osu! user:', error.message);
        }
      } else {
        await db.run('DELETE FROM settings WHERE key IN (?, ?, ?)', 'connected_user_id', 'connected_username', 'connected_avatar');
      }
    }

    res.json({ success: true, message: 'Settings saved successfully' });
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
    const oauthUrl = `https://osu.ppy.sh/oauth/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify`;

    res.json({ url: oauthUrl });
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/oauth-callback - handle callback from osu! OAuth redirect
router.get('/oauth-callback', async (req, res, next) => {
  const { code, error: oauthError, error_description: oauthErrorDesc } = req.query;
  
  // Handle OAuth errors from osu! (e.g., user denied access)
  if (oauthError) {
    console.error('OAuth error from osu!:', oauthError, oauthErrorDesc);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
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
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
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
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
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
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
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
