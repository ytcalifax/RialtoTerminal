import { REQUEST_TIMEOUT_MS } from './constants.js';

/**
 * Fetch a JSON payload from an API path.
 * @param {string} path - e.g. `/api/news?feed=global`
 * @param {{timeoutMs?: number}} [options]
 * @throws {Error} `HTTP <status>` for non-2xx, or on client timeout.
 */
async function req(path, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { signal: controller.signal });
    if (!response.ok) {
      // Surface the backend's structured error detail when it provides one.
      let detail = '';
      try {
        const body = await response.json();
        if (body && body.error) detail = ` · ${body.error}`;
      } catch { /* non-JSON error body */ }
      throw new Error(`HTTP ${response.status}${detail}`);
    }
    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`client timeout after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export { req };
