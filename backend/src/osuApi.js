const fs = require('fs');
const path = require('path');
const { getDatabase, coversDir } = require('./db');

let accessToken = null;
let tokenExpiresAt = null;
let rateLimitedUntil = null;
let lastRequestTime = 0;
const RATE_LIMIT_WAIT = 30000;
const MIN_REQUEST_INTERVAL = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function throttle() {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await sleep(MIN_REQUEST_INTERVAL - elapsed);
  }
}

async function waitIfRateLimited() {
  while (rateLimitedUntil && Date.now() < rateLimitedUntil) {
    const remaining = Math.ceil((rateLimitedUntil - Date.now()) / 1000);
    console.warn(`[osuApi] Rate limited. Waiting ${remaining}s...`);
    await sleep(2000);
  }
}

function setRateLimited() {
  rateLimitedUntil = Date.now() + RATE_LIMIT_WAIT;
  console.warn(`[osuApi] 429 detected. Pausing all API calls for ${RATE_LIMIT_WAIT / 1000}s.`);
}

// Get credentials from environment or settings table
async function getCredentials() {
  const db = await getDatabase();
  const idSetting = await db.get('SELECT value FROM settings WHERE key = ?', 'osu_client_id');
  const secretSetting = await db.get('SELECT value FROM settings WHERE key = ?', 'osu_client_secret');

  const client_id = process.env.OSU_CLIENT_ID || (idSetting ? idSetting.value : null);
  const client_secret = process.env.OSU_CLIENT_SECRET || (secretSetting ? secretSetting.value : null);

  return { client_id, client_secret };
}

// Fetch a new access token using client credentials
async function getAccessToken() {
  if (accessToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    return accessToken;
  }

  const { client_id, client_secret } = await getCredentials();

  if (!client_id || !client_secret) {
    throw new Error('osu! API credentials are not configured. Please set them in settings or .env file.');
  }

  await waitIfRateLimited();
  await throttle();

  const response = await fetch('https://osu.ppy.sh/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      client_id: parseInt(client_id, 10),
      client_secret: client_secret,
      grant_type: 'client_credentials',
      scope: 'public'
    })
  });

  lastRequestTime = Date.now();

  if (response.status === 429) {
    setRateLimited();
    await waitIfRateLimited();
    return getAccessToken();
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to fetch osu! OAuth token: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  accessToken = data.access_token;
  // Expire 1 minute early to be safe
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken;
}

// Helper to make authenticated requests to osu! API
async function apiFetch(endpoint) {
  await waitIfRateLimited();
  await throttle();

  const token = await getAccessToken();
  const url = endpoint.startsWith('http') ? endpoint : `https://osu.ppy.sh/api/v2/${endpoint.replace(/^\//, '')}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'x-api-version': '20220705'
    }
  });

  lastRequestTime = Date.now();

  if (response.status === 429) {
    setRateLimited();
    await waitIfRateLimited();
    return apiFetch(endpoint);
  }

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const errText = await response.text();
    throw new Error(`osu! API Error [${response.status}]: ${errText}`);
  }

  return response.json();
}

// Fetch beatmapset details
async function fetchBeatmapset(beatmapsetId) {
  return apiFetch(`beatmapsets/${beatmapsetId}`);
}

// Fetch beatmap details (to find its beatmapset)
async function fetchBeatmap(beatmapId) {
  return apiFetch(`beatmaps/${beatmapId}`);
}

// Fetch user profile (caches requesters)
async function fetchUser(userIdOrUsername) {
  // If it's a numeric ID, search by ID, otherwise by username
  const isNumeric = /^\d+$/.test(userIdOrUsername);
  const keyType = isNumeric ? 'id' : 'username';
  return apiFetch(`users/${encodeURIComponent(userIdOrUsername)}/osu?key=${keyType}`);
}

// Download cover image to local directory
async function downloadCover(beatmapsetId, coverUrl) {
  try {
    const destPath = path.resolve(coversDir, `${beatmapsetId}.jpg`);
    
    // Default cover fallback if not provided
    const url = coverUrl || `https://assets.ppy.sh/beatmaps/${beatmapsetId}/covers/cover.jpg`;

    const res = await fetch(url);
    if (!res.ok) {
      // Try fallback URL if the provided one failed
      if (url !== `https://assets.ppy.sh/beatmaps/${beatmapsetId}/covers/cover.jpg`) {
        return downloadCover(beatmapsetId, `https://assets.ppy.sh/beatmaps/${beatmapsetId}/covers/cover.jpg`);
      }
      throw new Error(`Failed to download cover image: status ${res.status}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.promises.writeFile(destPath, buffer);
    return `/uploads/covers/${beatmapsetId}.jpg`;
  } catch (error) {
    console.error(`Error downloading cover for beatmapset ${beatmapsetId}:`, error.message);
    // Return a default placeholder string or local route to handle error gracefully
    return `/uploads/covers/default.jpg`;
  }
}

module.exports = {
  fetchBeatmapset,
  fetchBeatmap,
  fetchUser,
  downloadCover,
  getCredentials
};
