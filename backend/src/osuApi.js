const fs = require('fs');
const path = require('path');
const { getDatabase, coversDir } = require('./db');

let accessToken = null;
let tokenExpiresAt = null;
let accessTokenRequest = null;
let rateLimitedUntil = null;
let lastRequestTime = 0;
let apiRequestQueue = Promise.resolve();
let pendingApiRequests = 0;
let lastApiError = null;
let lastApiErrorAt = null;
let nextApiJobId = 1;
const apiJobs = new Map();
const RATE_LIMIT_WAIT = 30000;
const MIN_REQUEST_INTERVAL = 2000;
const NETWORK_TIMEOUT_MS = 30000;
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_BEATMAPS_PER_REQUEST = 50;

async function fetchWithTimeout(url, options = {}, timeoutMs = NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function throttle() {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await sleep(MIN_REQUEST_INTERVAL - elapsed);
  }
}

function queueApiRequest(request) {
  const queuedRequest = apiRequestQueue.then(async () => {
    await waitIfRateLimited();
    await throttle();
    const response = await request();
    lastRequestTime = Date.now();
    if (response.status === 429) setRateLimited();
    return response;
  });
  apiRequestQueue = queuedRequest.catch(() => {});
  return queuedRequest;
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

function clearAccessToken() {
  accessToken = null;
  tokenExpiresAt = null;
  accessTokenRequest = null;
}

// Credentials are configured in the app settings so development and packaged
// runs use one source of truth.
async function getCredentials() {
  const db = await getDatabase();
  const idSetting = await db.get('SELECT value FROM settings WHERE key = ?', 'osu_client_id');
  const secretSetting = await db.get('SELECT value FROM settings WHERE key = ?', 'osu_client_secret');

  const client_id = idSetting ? idSetting.value : null;
  const client_secret = secretSetting ? secretSetting.value : null;

  return { client_id, client_secret };
}

// Fetch a new access token using client credentials
async function requestAccessToken(rateLimitRetries = 0) {
  if (accessToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    return accessToken;
  }

  const { client_id, client_secret } = await getCredentials();

  if (!client_id || !client_secret) {
    throw new Error('osu! API credentials are not configured. Please add them in Settings.');
  }

  const response = await queueApiRequest(() => fetchWithTimeout('https://osu.ppy.sh/oauth/token', {
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
  }));

  if (response.status === 429) {
    if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES) {
      throw new Error('osu! API rate limit persisted after several retries.');
    }
    await waitIfRateLimited();
    return requestAccessToken(rateLimitRetries + 1);
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

async function getAccessToken() {
  if (accessToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    return accessToken;
  }
  if (!accessTokenRequest) {
    accessTokenRequest = requestAccessToken().finally(() => {
      accessTokenRequest = null;
    });
  }
  return accessTokenRequest;
}

// Helper to make authenticated requests to osu! API
async function apiFetch(endpoint, rateLimitRetries = 0) {
  pendingApiRequests++;
  try {
    const token = await getAccessToken();
    const url = endpoint.startsWith('http') ? endpoint : `https://osu.ppy.sh/api/v2/${endpoint.replace(/^\//, '')}`;

    const response = await queueApiRequest(() => fetchWithTimeout(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'x-api-version': '20220705'
      }
    }));

    if (response.status === 429) {
      if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES) {
        throw new Error('osu! API rate limit persisted after several retries.');
      }
      await waitIfRateLimited();
      return apiFetch(endpoint, rateLimitRetries + 1);
    }

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const errText = await response.text();
      throw new Error(`osu! API Error [${response.status}]: ${errText}`);
    }

    return response.json();
  } catch (error) {
    lastApiError = error.message;
    lastApiErrorAt = Date.now();
    throw error;
  } finally {
    pendingApiRequests--;
  }
}

function getApiStatus() {
  const rateLimitSeconds = rateLimitedUntil && rateLimitedUntil > Date.now()
    ? Math.ceil((rateLimitedUntil - Date.now()) / 1000)
    : 0;
  const jobs = Array.from(apiJobs.values()).map(job => ({
    ...job,
    remainingRequests: Math.max(0, job.totalRequests - job.completedRequests)
  }));
  const queuedJobRequests = jobs.reduce((total, job) => total + job.remainingRequests, 0);
  const throttleSeconds = Math.ceil(((pendingApiRequests + queuedJobRequests) * MIN_REQUEST_INTERVAL) / 1000);

  return {
    pendingRequests: pendingApiRequests,
    queuedRequests: queuedJobRequests,
    jobs,
    throttleMs: MIN_REQUEST_INTERVAL,
    estimatedSeconds: Math.max(throttleSeconds, rateLimitSeconds),
    rateLimitedSeconds: rateLimitSeconds,
    lastError: lastApiError,
    lastErrorAt: lastApiErrorAt
  };
}

function createApiJob(label, totalRequests = 0) {
  const id = nextApiJobId++;
  apiJobs.set(id, { id, label, totalRequests, completedRequests: 0 });
  return id;
}

function addApiJobWork(id, requestCount) {
  const job = apiJobs.get(id);
  if (job) job.totalRequests += requestCount;
}

function updateApiJob(id, completedRequests) {
  const job = apiJobs.get(id);
  if (job) job.completedRequests += completedRequests;
}

function finishApiJob(id) {
  apiJobs.delete(id);
}

// Fetch beatmapset details
async function fetchBeatmapset(beatmapsetId) {
  return apiFetch(`beatmapsets/${beatmapsetId}`);
}

// Fetch beatmap details (to find its beatmapset)
async function fetchBeatmap(beatmapId) {
  return apiFetch(`beatmaps/${beatmapId}`);
}

// Fetch beatmaps in API-sized batches and align results with the input IDs.
async function fetchBeatmaps(beatmapIds, { onBatchError } = {}) {
  if (!Array.isArray(beatmapIds) || beatmapIds.length === 0) {
    return [];
  }

  const normalizedIds = beatmapIds.map(id => {
    const numericId = typeof id === 'string' && id.trim() !== '' ? Number(id) : id;
    return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null;
  });
  const uniqueIds = [...new Set(normalizedIds.filter(id => id !== null))];
  const beatmapsById = new Map();

  for (let i = 0; i < uniqueIds.length; i += MAX_BEATMAPS_PER_REQUEST) {
    const batch = uniqueIds.slice(i, i + MAX_BEATMAPS_PER_REQUEST);
    const query = batch.map(id => `ids[]=${id}`).join('&');

    try {
      const data = await apiFetch(`beatmaps?${query}`);
      const beatmaps = Array.isArray(data?.beatmaps) ? data.beatmaps : [];
      for (const beatmap of beatmaps) {
        if (Number.isSafeInteger(beatmap?.id)) {
          beatmapsById.set(beatmap.id, beatmap);
        }
      }
    } catch (error) {
      console.error(`Failed to fetch beatmap batch starting with ID ${batch[0]}:`, error.message);
      onBatchError?.(batch, error);
    }
  }

  return normalizedIds.map(id => id === null ? null : beatmapsById.get(id) || null);
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

    const res = await fetchWithTimeout(url);
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
  fetchBeatmaps,
  fetchUser,
  downloadCover,
  getCredentials,
  getApiStatus,
  createApiJob,
  addApiJobWork,
  updateApiJob,
  finishApiJob,
  clearAccessToken
};
