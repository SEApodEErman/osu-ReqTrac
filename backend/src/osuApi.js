const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { getDatabase, coversDir } = require('./db');

let accessToken = null;
let tokenExpiresAt = null;
let accessTokenRequest = null;
let rateLimitedUntil = null;
let lastRequestTime = 0;
let pendingApiRequests = 0;
let lastApiError = null;
let lastApiErrorAt = null;
let nextApiJobId = 1;
let nextApiRequestId = 1;
const apiJobs = new Map();
const RATE_LIMIT_WAIT = 30000;
const NETWORK_TIMEOUT_MS = 30000;
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_BEATMAPS_PER_REQUEST = 50;
const MAX_USERS_PER_REQUEST = 50;

// osu! allows 1200 requests/minute but asks API consumers to stay at or below
// 60/minute. Calls are scheduled through priority lanes so work the user is
// waiting on is never stuck behind background synchronization:
//   interactive - a user action in the UI (add, open, refresh one request)
//   bulk        - jobs the user started and is watching (imports, date refresh)
//   background  - passive upkeep (metadata sync worker, username refresh)
// User-driven lanes use the recommended 60/minute pace; background upkeep
// keeps a slower pace so it never consumes the whole budget on its own.
const API_PRIORITIES = ['interactive', 'bulk', 'background'];
const DEFAULT_MIN_REQUEST_INTERVALS = [1000, 1000, 2000];
let minRequestIntervals = [...DEFAULT_MIN_REQUEST_INTERVALS];
const MIN_REQUEST_INTERVAL = DEFAULT_MIN_REQUEST_INTERVALS[0];
const apiPriorityContext = new AsyncLocalStorage();
const apiLanes = API_PRIORITIES.map(() => []);
let apiPumpRunning = false;
const inflightApiFetches = new Map();

function priorityRank(priority) {
  const rank = API_PRIORITIES.indexOf(priority);
  return rank === -1 ? 1 : rank;
}

// Run fn (and every osu! API call it makes, including in awaited
// continuations) at the given priority.
function runWithApiPriority(priority, fn) {
  return apiPriorityContext.run(priority, fn);
}

function currentApiRank() {
  return priorityRank(apiPriorityContext.getStore() ?? 'bulk');
}

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

function nextQueuedApiRequest() {
  const lane = apiLanes.find(items => items.length > 0);
  return lane ? lane[0] : null;
}

async function pumpApiQueue() {
  if (apiPumpRunning) return;
  apiPumpRunning = true;
  try {
    for (let item = nextQueuedApiRequest(); item; item = nextQueuedApiRequest()) {
      await waitIfRateLimited();
      // Re-check the head while waiting so a newly queued interactive call
      // takes over the next slot with its own (shorter) spacing.
      for (;;) {
        item = nextQueuedApiRequest();
        const wait = lastRequestTime + minRequestIntervals[item.rank] - Date.now();
        if (wait <= 0) break;
        await sleep(Math.min(wait, 200));
      }
      apiLanes[item.rank].shift();
      item.started = true;
      console.log(`${item.logPrefix} Sending ${item.description} (${API_PRIORITIES[item.rank]}).`);
      try {
        const response = await item.request();
        lastRequestTime = Date.now();
        if (response.status === 429) setRateLimited();
        console.log(`${item.logPrefix} Completed ${item.description} with HTTP ${response.status}.`);
        item.resolve(response);
      } catch (error) {
        lastRequestTime = Date.now();
        console.error(`${item.logPrefix} Failed ${item.description}:`, error.message);
        item.reject(error);
      }
    }
  } finally {
    apiPumpRunning = false;
  }
}

function promoteQueuedApiRequest(item, rank) {
  if (!item || item.started || rank >= item.rank) return;
  const lane = apiLanes[item.rank];
  const index = lane.indexOf(item);
  if (index === -1) return;
  lane.splice(index, 1);
  item.rank = rank;
  apiLanes[rank].push(item);
}

function queueApiRequest(request, description, { rank = currentApiRank(), onQueued } = {}) {
  const requestId = nextApiRequestId++;
  const logPrefix = `[osuApi #${requestId}]`;
  console.log(`${logPrefix} Queued ${description}.`);
  return new Promise((resolve, reject) => {
    const item = { request, description, logPrefix, rank, resolve, reject, started: false };
    apiLanes[rank].push(item);
    onQueued?.(item);
    void pumpApiQueue();
  });
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

function describeApiRequest(endpoint) {
  const [path, query] = endpoint.split('?', 2);
  const beatmapsetMatch = path.match(/^beatmapsets\/(\d+)$/);
  if (beatmapsetMatch) return `fetch beatmapset ${beatmapsetMatch[1]}`;

  const beatmapMatch = path.match(/^beatmaps\/(\d+)$/);
  if (beatmapMatch) return `fetch beatmap ${beatmapMatch[1]}`;

  if (path === 'users') {
    const ids = [...new URLSearchParams(query || '').getAll('ids[]')];
    if (ids.length) return `fetch ${ids.length} user${ids.length === 1 ? '' : 's'}`;
  }

  if (path === 'beatmaps') {
    const ids = [...new URLSearchParams(query || '').getAll('ids[]')];
    if (ids.length) {
      const range = ids.length === 1 ? ids[0] : `${ids[0]}–${ids[ids.length - 1]}`;
      return `fetch ${ids.length} beatmap${ids.length === 1 ? '' : 's'} (IDs ${range})`;
    }
  }

  const userMatch = path.match(/^users\/([^/]+)\/osu$/);
  if (userMatch) return `fetch user ${decodeURIComponent(userMatch[1])}`;

  return `GET ${endpoint}`;
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
  }), 'POST OAuth client-credentials token');

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
  console.log('[osuApi] OAuth token acquired.');
  return accessToken;
}

// Exchange the given credentials for a token without caching it, so the
// first-run setup can tell the user whether osu! actually accepts them.
async function verifyCredentials(clientId, clientSecret) {
  const numericClientId = Number.parseInt(String(clientId ?? '').trim(), 10);
  const secret = String(clientSecret ?? '').trim();
  if (!Number.isSafeInteger(numericClientId) || numericClientId <= 0) {
    return { ok: false, error: 'The Client ID must be the number shown on your osu! OAuth application.' };
  }
  if (!secret) return { ok: false, error: 'Enter the Client Secret from your osu! OAuth application.' };

  try {
    const response = await queueApiRequest(() => fetchWithTimeout('https://osu.ppy.sh/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ client_id: numericClientId, client_secret: secret, grant_type: 'client_credentials', scope: 'public' }),
    }), 'POST OAuth credential verification');
    if (response.ok) return { ok: true };
    if (response.status === 400 || response.status === 401) {
      return { ok: false, error: 'osu! rejected these credentials. Check that the Client ID and Client Secret belong to the same OAuth application.' };
    }
    if (response.status === 429) return { ok: false, error: 'osu! is rate limiting requests right now. Try again in a minute.' };
    return { ok: false, error: `osu! returned an unexpected response (HTTP ${response.status}). Try again later.` };
  } catch (error) {
    return { ok: false, error: `Could not reach osu! to verify the credentials: ${error.message}` };
  }
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

// Helper to make authenticated requests to osu! API. Identical concurrent GETs
// share one call; a higher-priority caller promotes the queued call.
function apiFetch(endpoint) {
  const rank = currentApiRank();
  const existing = inflightApiFetches.get(endpoint);
  if (existing) {
    existing.promote(rank);
    return existing.promise;
  }

  const entry = {
    rank,
    item: null,
    promote(nextRank) {
      this.rank = Math.min(this.rank, nextRank);
      promoteQueuedApiRequest(this.item, this.rank);
    },
  };
  entry.promise = performApiFetch(endpoint, entry).finally(() => inflightApiFetches.delete(endpoint));
  inflightApiFetches.set(endpoint, entry);
  return entry.promise;
}

async function performApiFetch(endpoint, entry) {
  pendingApiRequests++;
  const requestDescription = describeApiRequest(endpoint);
  try {
    const url = endpoint.startsWith('http') ? endpoint : `https://osu.ppy.sh/api/v2/${endpoint.replace(/^\//, '')}`;
    let response;
    for (let rateLimitRetries = 0; ; rateLimitRetries++) {
      const token = await runWithApiPriority(API_PRIORITIES[entry.rank], () => getAccessToken());
      response = await queueApiRequest(() => fetchWithTimeout(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'x-api-version': '20220705'
        }
      }), requestDescription, { rank: entry.rank, onQueued: item => { entry.item = item; } });

      if (response.status !== 429) break;
      if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES) {
        throw new Error('osu! API rate limit persisted after several retries.');
      }
      await waitIfRateLimited();
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
    console.error(`[osuApi] ${requestDescription} failed:`, error.message);
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
  const queuedByPriority = Object.fromEntries(API_PRIORITIES.map((priority, rank) => [priority, apiLanes[rank].length]));

  return {
    pendingRequests: pendingApiRequests,
    queuedRequests: queuedJobRequests,
    jobs,
    queuedByPriority,
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

// Fetch up to 50 users per call. Returns a Map of user ID to user for every
// user osu! returned; IDs from a failed batch are reported through onBatchError.
async function fetchUsers(userIds, { onBatchError } = {}) {
  const ids = [...new Set((userIds || []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
  const usersById = new Map();
  for (let i = 0; i < ids.length; i += MAX_USERS_PER_REQUEST) {
    const batch = ids.slice(i, i + MAX_USERS_PER_REQUEST);
    try {
      const data = await apiFetch(`users?${batch.map(id => `ids[]=${id}`).join('&')}`);
      for (const user of Array.isArray(data?.users) ? data.users : []) {
        if (Number.isSafeInteger(user?.id)) usersById.set(user.id, user);
      }
    } catch (error) {
      console.error(`Failed to fetch user batch starting with ID ${batch[0]}:`, error.message);
      onBatchError?.(batch, error);
    }
  }
  return usersById;
}

// Fetch user profile (caches requesters)
async function fetchUser(userIdOrUsername) {
  // If it's a numeric ID, search by ID, otherwise by username
  const isNumeric = /^\d+$/.test(userIdOrUsername);
  const keyType = isNumeric ? 'id' : 'username';
  return apiFetch(`users/${encodeURIComponent(userIdOrUsername)}/osu?key=${keyType}`);
}

// Cover images are only ever fetched from the official osu! asset CDN. The
// cover URL is attacker-controllable through restored backup data
// (beatmap_cache.cover_url), and its response is written to disk and served
// back from /uploads/covers, so allowing arbitrary URLs here would be an SSRF
// with a response-exfiltration channel. Anything else falls back to the
// canonical assets.ppy.sh URL derived from the validated beatmapset ID.
const ALLOWED_COVER_HOSTS = new Set(['assets.ppy.sh']);

function isAllowedCoverUrl(coverUrl) {
  if (typeof coverUrl !== 'string' || !coverUrl) return false;
  try {
    const url = new URL(coverUrl);
    return url.protocol === 'https:'
      && ALLOWED_COVER_HOSTS.has(url.host)
      && url.pathname.startsWith('/beatmaps/');
  } catch {
    return false;
  }
}

// Download cover image to local directory
async function downloadCover(beatmapsetId, coverUrl) {
  const numericBeatmapsetId = Number(beatmapsetId);
  if (!Number.isSafeInteger(numericBeatmapsetId) || numericBeatmapsetId <= 0) {
    return '/uploads/covers/default.jpg';
  }
  try {
    const destPath = path.resolve(coversDir, `${numericBeatmapsetId}.jpg`);
    
    // Default cover fallback if not provided
    const fallbackUrl = `https://assets.ppy.sh/beatmaps/${numericBeatmapsetId}/covers/cover.jpg`;
    const url = isAllowedCoverUrl(coverUrl) ? coverUrl : fallbackUrl;
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      // Try fallback URL if the provided one failed
      if (url !== fallbackUrl) {
        return downloadCover(numericBeatmapsetId, fallbackUrl);
      }
      throw new Error(`Failed to download cover image: status ${res.status}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.promises.writeFile(destPath, buffer);
    return `/uploads/covers/${numericBeatmapsetId}.jpg`;
  } catch (error) {
    console.error(`Error downloading cover for beatmapset ${numericBeatmapsetId}:`, error.message);
    // Return a default placeholder string or local route to handle error gracefully
    return '/uploads/covers/default.jpg';
  }
}

module.exports = {
  fetchBeatmapset,
  fetchBeatmap,
  fetchBeatmaps,
  fetchUser,
  fetchUsers,
  downloadCover,
  getCredentials,
  getApiStatus,
  createApiJob,
  addApiJobWork,
  updateApiJob,
  finishApiJob,
  clearAccessToken,
  isAllowedCoverUrl,
  verifyCredentials,
  runWithApiPriority,
  API_PRIORITIES,
  testUtils: {
    setMinRequestIntervals(intervals) {
      minRequestIntervals = intervals ? [...intervals] : [...DEFAULT_MIN_REQUEST_INTERVALS];
    },
  },
};
