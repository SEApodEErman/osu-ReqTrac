export const API_REQUEST_TIMEOUT_MS = 30000;

export class ApiError extends Error {
  constructor(message, { status = 0, data = null, code = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.code = code || data?.code || null;
  }
}

export function fetchWithTimeout(input, init = {}, timeoutMs = API_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  init.signal?.addEventListener?.('abort', abortFromCaller, { once: true });
  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => {
      window.clearTimeout(timeoutId);
      init.signal?.removeEventListener?.('abort', abortFromCaller);
    });
}

// JSON request helper used by every screen. Resolves with the parsed body and
// throws an ApiError carrying the server's own error message otherwise.
export async function apiRequest(path, { method = 'GET', body, timeoutMs = API_REQUEST_TIMEOUT_MS, signal, keepalive = false } = {}) {
  const init = { method, signal, keepalive };
  if (body instanceof FormData || body instanceof Blob || typeof body === 'string') {
    init.body = body;
    if (typeof body === 'string') init.headers = { 'Content-Type': 'application/json' };
    else if (body instanceof Blob && body.type) init.headers = { 'Content-Type': body.type };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }

  let response;
  try {
    response = await fetchWithTimeout(path, init, timeoutMs);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error.name === 'AbortError') {
      throw new ApiError('The local ReqTrac server took too long to respond. Try again in a moment.', { code: 'TIMEOUT' });
    }
    throw new ApiError('Could not reach the local ReqTrac server. Restart the app if this keeps happening.', { code: 'NETWORK' });
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    throw new ApiError(data?.error || data?.message || `The request failed (HTTP ${response.status}).`, { status: response.status, data });
  }
  return data;
}

export const api = {
  get: (path, options) => apiRequest(path, options),
  post: (path, body, options) => apiRequest(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => apiRequest(path, { ...options, method: 'PATCH', body }),
  delete: (path, body, options) => apiRequest(path, { ...options, method: 'DELETE', body }),
};
