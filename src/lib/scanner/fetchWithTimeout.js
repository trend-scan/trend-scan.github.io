/**
 * fetchWithTimeout — wraps fetch() with an AbortController-based timeout.
 *
 * Unlike Promise.race, this actually aborts the underlying fetch() when
 * the timeout fires, freeing the browser's connection slot immediately.
 * This prevents hung sockets from silently occupying pool workers until
 * the browser's TCP timeout (which can be minutes).
 *
 * @param {string} url - URL to fetch
 * @param {object} [options] - standard fetch options
 * @param {number} [timeoutMs=10000] - timeout in milliseconds
 * @returns {Promise<Response>}
 * @throws {Error} with .name === 'TimeoutError' if the timeout fires
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return res;
  } catch (e) {
    // Distinguish timeout aborts from network errors
    if (e.name === 'AbortError') {
      const err = new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
      err.name = 'TimeoutError';
      err.url = url;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Sanitize asset metadata — strip zero-width spaces, BOM, and other
 * non-printing characters that leak through from upstream data sources.
 *
 * @param {string} str - the string to clean
 * @returns {string} the cleaned string
 */
export function sanitizeMetadata(str) {
  if (typeof str !== 'string') return str;
  // Strip: zero-width space (U+200B), zero-width non-joiner (U+200C),
  // zero-width joiner (U+200D), BOM (U+FEFF), soft hyphen (U+00AD),
  // and other Unicode formatting characters.
  return str.replace(/[\u200B-\u200D\uFEFF\u00AD\u2060]/g, '').trim();
}
