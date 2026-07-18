let locked = false;
let acquiring = false;
let activeRequests = 0;
const waiters = [];
const idleWaiters = [];

function wakeWaiters() {
  while (waiters.length > 0) waiters.shift()();
}

function markIdle() {
  if (activeRequests === 0) {
    while (idleWaiters.length > 0) idleWaiters.shift()();
  }
}

async function waitForBackupUnlock(req, res, next) {
  // Backup and data-reset routes acquire the barrier themselves and must not
  // count as active requests while waiting for other API work to drain.
  if (/(?:^|\/)(?:migration\/(?:export|import-json)|settings\/delete-all-data)(?:\/|$)/.test(req.path)) {
    next();
    return;
  }
  while (locked || acquiring) {
    await new Promise(resolve => waiters.push(resolve));
  }
  activeRequests++;
  let finished = false;
  const releaseRequest = () => {
    if (finished) return;
    finished = true;
    activeRequests--;
    markIdle();
  };
  res.once('finish', releaseRequest);
  res.once('close', releaseRequest);
  next();
}

async function acquireBackupLock() {
  while (locked || acquiring) {
    await new Promise(resolve => waiters.push(resolve));
  }
  acquiring = true;
  while (activeRequests > 0) {
    await new Promise(resolve => idleWaiters.push(resolve));
  }
  locked = true;
  acquiring = false;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locked = false;
    wakeWaiters();
  };
}

module.exports = { acquireBackupLock, waitForBackupUnlock };
