const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db');
const { getCredentials } = require('../osuApi');

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
      clientId: credentials.client_id ? '********' : null, // obfuscate client ID slightly or show length
      connectedAccount: usernameRow ? {
        username: usernameRow.value,
        avatar: avatarRow ? avatarRow.value : null,
        id: userIdRow ? parseInt(userIdRow.value, 10) : null
      } : null
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/settings - configure client credentials
router.post('/', async (req, res, next) => {
  try {
    const { client_id, client_secret } = req.body;
    const db = await getDatabase();

    if (client_id !== undefined) {
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'osu_client_id', client_id.toString().trim());
    }
    if (client_secret !== undefined) {
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'osu_client_secret', client_secret.toString().trim());
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

// GET /api/settings/oauth-url - generate OAuth URL for user authentication
router.get('/oauth-url', async (req, res, next) => {
  try {
    const { client_id } = await getCredentials();
    if (!client_id) {
      return res.status(400).json({ error: 'osu! Client ID not configured.' });
    }

    const redirectUri = req.query.redirect_uri || 'http://localhost:3001/api/settings/oauth-callback';
    const oauthUrl = `https://osu.ppy.sh/oauth/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify`;

    res.json({ url: oauthUrl });
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/oauth-callback - handle callback from osu! OAuth redirect
router.get('/oauth-callback', async (req, res, next) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Authorization code missing.');
  }

  try {
    const { client_id, client_secret } = await getCredentials();
    const redirectUri = 'http://localhost:3001/api/settings/oauth-callback';

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

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return res.status(500).send(`Failed to exchange authorization code: ${errText}`);
    }

    const tokenData = await tokenRes.json();
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
      return res.status(500).send(`Failed to fetch user profile: ${errText}`);
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
    res.status(500).send(`OAuth Authentication Error: ${error.message}`);
  }
});

module.exports = router;
