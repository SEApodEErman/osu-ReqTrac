// Central request guard for the loopback-only API server.
//
// The backend has no application-level authentication: its trust boundary is
// "only software running on this machine may talk to it". Two web-platform
// features can violate that boundary without any local code execution:
//
//   1. Cross-origin fetches from arbitrary websites. Browsers happily connect
//      to 127.0.0.1; without an origin check (and with permissive CORS) any
//      web page could read the API's responses or fire state-changing POSTs.
//   2. DNS rebinding. A hostile hostname can resolve to 127.0.0.1 so requests
//      arrive with a valid-looking Host header pointing at this server.
//
// This middleware enforces the boundary in one place: the request must carry
// a loopback Host, must not carry a non-loopback Origin, and cross-site
// browser requests are only allowed to be top-level navigations (the OAuth
// callbacks need those). Everything else is rejected before any route runs.

const LOOPBACK_HOST_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i;

function isLoopbackHost(hostHeader) {
  if (typeof hostHeader !== 'string') return false;
  return LOOPBACK_HOST_PATTERN.test(hostHeader.trim());
}

function isLoopbackOrigin(origin) {
  if (typeof origin !== 'string' || !origin || origin === 'null') return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOST_PATTERN.test(url.host);
}

// CORS only needs to reflect loopback origins (the Vite dev server and the
// Electron-served UI, which is same-origin). Anything else gets no
// Access-Control-Allow-Origin and therefore cannot read responses.
function corsOriginCallback(origin, callback) {
  callback(null, !origin || isLoopbackOrigin(origin));
}

function localApiGuard(req, res, next) {
  const reject = () => res.status(403).json({ error: 'Forbidden: the local API only accepts loopback requests.' });

  if (!isLoopbackHost(req.get('host'))) return reject();

  const origin = req.get('origin');
  if (origin && !isLoopbackOrigin(origin)) return reject();

  const fetchSite = (req.get('sec-fetch-site') || '').toLowerCase();
  if (fetchSite === 'cross-site') {
    // Top-level navigations are allowed: the OAuth provider redirects land
    // here in the user's browser. Nothing else may cross the site boundary.
    const fetchMode = (req.get('sec-fetch-mode') || '').toLowerCase();
    const fetchDest = (req.get('sec-fetch-dest') || '').toLowerCase();
    const isTopLevelNavigation = fetchMode === 'navigate' && fetchDest === 'document';
    if (!isTopLevelNavigation || !['GET', 'HEAD'].includes(req.method)) return reject();
  }

  return next();
}

module.exports = {
  corsOriginCallback,
  isLoopbackHost,
  isLoopbackOrigin,
  localApiGuard,
};
