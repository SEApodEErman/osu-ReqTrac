export const API_REQUEST_TIMEOUT_MS = 30000;

export function fetchWithTimeout(input, init = {}, timeoutMs = API_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => window.clearTimeout(timeoutId));
}
