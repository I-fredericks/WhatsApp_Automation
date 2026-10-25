/**
 * Utility helpers for the WhatsApp campaign tool.
 */

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a random integer between min and max (inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Wait for a random duration between min and max seconds.
 * @param {number} minSeconds
 * @param {number} maxSeconds
 * @returns {Promise<number>} the actual delay in ms
 */
async function randomDelay(minSeconds, maxSeconds) {
  const delayMs = randomInt(minSeconds, maxSeconds) * 1000;
  await sleep(delayMs);
  return delayMs;
}

/**
 * Parse a raw phone number string into a WhatsApp-friendly format.
 * Removes spaces, dashes, plus signs and non-digit characters.
 * @param {string} raw
 * @returns {string|null}
 */
function sanitizePhoneNumber(raw) {
  const cleaned = String(raw).replace(/[^0-9]/g, '').trim();
  return cleaned.length >= 8 ? cleaned : null;
}

/**
 * Parse numbers from raw text. Supports one number per line or comma-separated
 * values. Empty/invalid entries are skipped and duplicates are removed.
 * @param {string} content
 * @returns {string[]}
 */
function parseNumberList(content) {
  const rawEntries = String(content)
    .split(/[\r?\n,]+/)
    .map((entry) => entry.trim());

  return [...new Set(rawEntries.map((entry) => sanitizePhoneNumber(entry)).filter(Boolean))];
}

/**
 * Format a number with WhatsApp country code placeholder if needed.
 * This is a minimal helper; users are expected to upload full international numbers.
 * @param {string} number
 * @returns {string}
 */
function formatWhatsAppId(number) {
  return `${number}@c.us`;
}

/**
 * Parse a proxy string into a normalized URL object.
 * Accepts: host:port, http://host:port, http://user:pass@host:port, socks5://host:port
 * @param {string} raw
 * @returns {URL|null} parsed URL or null when invalid
 */
function parseProxyUrl(raw) {
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  let candidate = raw.trim();
  if (!candidate) {
    return null;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    candidate = `http://${candidate}`;
  }
  try {
    const url = new URL(candidate);
    if (!url.hostname || !url.port) {
      return null;
    }
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
    return url;
  } catch (err) {
    return null;
  }
}

module.exports = {
  sleep,
  randomInt,
  randomDelay,
  sanitizePhoneNumber,
  parseNumberList,
  formatWhatsAppId,
  parseProxyUrl,
};
