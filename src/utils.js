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
 * Parse numbers from a text file content. One number per line.
 * Empty lines and invalid entries are skipped.
 * @param {string} content
 * @returns {string[]}
 */
function parseNumberList(content) {
  return content
    .split(/\r?\n/)
    .map((line) => sanitizePhoneNumber(line))
    .filter(Boolean);
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

module.exports = {
  sleep,
  randomInt,
  randomDelay,
  sanitizePhoneNumber,
  parseNumberList,
  formatWhatsAppId,
};
