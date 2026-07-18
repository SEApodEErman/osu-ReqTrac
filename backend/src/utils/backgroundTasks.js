const tasks = new Set();

function trackBackgroundTask(task) {
  const promise = Promise.resolve(task);
  tasks.add(promise);
  promise.finally(() => tasks.delete(promise)).catch(() => {});
  return promise;
}

async function waitForBackgroundTasks() {
  while (tasks.size > 0) {
    await Promise.allSettled([...tasks]);
  }
}

module.exports = { trackBackgroundTask, waitForBackgroundTasks };
