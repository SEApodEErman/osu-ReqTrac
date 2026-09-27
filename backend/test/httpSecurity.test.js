const test = require('node:test');
const assert = require('node:assert/strict');

const { corsOriginCallback, isLoopbackHost, isLoopbackOrigin, localApiGuard } = require('../src/utils/httpSecurity');

test('isLoopbackHost accepts only loopback hosts', () => {
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('localhost:3001'), true);
  assert.equal(isLoopbackHost('LocalHost:3000'), true);
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('127.0.0.1:3001'), true);
  assert.equal(isLoopbackHost('127.1.2.3:9999'), true);
  assert.equal(isLoopbackHost('[::1]:3001'), true);

  assert.equal(isLoopbackHost('evil.com'), false);
  assert.equal(isLoopbackHost('evil.com:3001'), false);
  assert.equal(isLoopbackHost('localhost.evil.com:3001'), false);
  assert.equal(isLoopbackHost('127.0.0.1.evil.com'), false);
  assert.equal(isLoopbackHost('localhost:3001.evil.com'), false);
  assert.equal(isLoopbackHost(''), false);
  assert.equal(isLoopbackHost(undefined), false);
  assert.equal(isLoopbackHost(['localhost']), false);
});

test('isLoopbackOrigin accepts loopback web origins only', () => {
  assert.equal(isLoopbackOrigin('http://localhost:3000'), true);
  assert.equal(isLoopbackOrigin('http://127.0.0.1:53211'), true);
  assert.equal(isLoopbackOrigin('https://localhost:3000'), true);

  assert.equal(isLoopbackOrigin('https://evil.com'), false);
  assert.equal(isLoopbackOrigin('http://localhost.evil.com'), false);
  assert.equal(isLoopbackOrigin('null'), false);
  assert.equal(isLoopbackOrigin('file://'), false);
  assert.equal(isLoopbackOrigin('not a url'), false);
  assert.equal(isLoopbackOrigin(''), false);
  assert.equal(isLoopbackOrigin(undefined), false);
});

test('corsOriginCallback reflects loopback origins and drops the rest', async () => {
  await new Promise(resolve => corsOriginCallback('http://localhost:3000', (err, allowed) => {
    assert.equal(err, null);
    assert.equal(allowed, true);
    resolve();
  }));
  await new Promise(resolve => corsOriginCallback(undefined, (err, allowed) => {
    assert.equal(err, null);
    assert.equal(allowed, true);
    resolve();
  }));
  await new Promise(resolve => corsOriginCallback('https://evil.com', (err, allowed) => {
    assert.equal(err, null);
    assert.equal(allowed, false);
    resolve();
  }));
});

function runGuard({ method = 'GET', headers = {} }) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  const req = { method, get: (name) => normalized[name.toLowerCase()] };
  let statusCode = null;
  let body = null;
  let nexted = false;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  localApiGuard(req, res, () => { nexted = true; });
  return { statusCode, body, nexted };
}

test('guard rejects cross-site browser requests even for simple form POSTs', () => {
  // A <form method=POST> from a hostile page sends Origin + Sec-Fetch-Site but
  // never triggers a CORS preflight, so CORS alone cannot stop it.
  const result = runGuard({
    method: 'POST',
    headers: {
      host: '127.0.0.1:3001',
      origin: 'https://evil.com',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'no-cors',
      'sec-fetch-dest': '',
    },
  });
  assert.equal(result.statusCode, 403);
  assert.equal(result.nexted, false);
});

test('guard rejects cross-site fetch and embed requests', () => {
  for (const headers of [
    { host: 'localhost:3001', origin: 'https://evil.com', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' },
    { host: 'localhost:3001', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' },
    { host: 'localhost:3001', origin: 'https://evil.com' },
  ]) {
    const result = runGuard({ method: 'GET', headers });
    assert.equal(result.statusCode, 403, JSON.stringify(headers));
    assert.equal(result.nexted, false);
  }
});

test('guard rejects DNS-rebinding hosts', () => {
  const result = runGuard({ method: 'GET', headers: { host: 'attacker.example:3001' } });
  assert.equal(result.statusCode, 403);
  assert.equal(result.nexted, false);
});

test('guard allows top-level cross-site navigations (OAuth callbacks)', () => {
  const result = runGuard({
    method: 'GET',
    headers: {
      host: 'localhost:3001',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
    },
  });
  assert.equal(result.nexted, true);
  assert.equal(result.statusCode, null);
});

test('guard allows same-origin and loopback app traffic', () => {
  for (const req of [
    { method: 'GET', headers: { host: '127.0.0.1:53211' } },
    { method: 'POST', headers: { host: '127.0.0.1:53211', origin: 'http://127.0.0.1:53211' } },
    { method: 'POST', headers: { host: 'localhost:3001', origin: 'http://localhost:3000' } },
    { method: 'GET', headers: { host: 'localhost:3001', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' } },
  ]) {
    const result = runGuard(req);
    assert.equal(result.nexted, true, JSON.stringify(req));
    assert.equal(result.statusCode, null);
  }
});
