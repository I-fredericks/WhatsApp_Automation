/**
 * Bulk campaign messaging service.
 * Sends a message to each imported number with randomized anti-ban delays.
 */

const { EventEmitter } = require('events');
const { randomDelay } = require('./utils');

class CampaignService extends EventEmitter {
  constructor(whatsappClient) {
    super();
    this.whatsappClient = whatsappClient;
    this._isRunning = false;
    this._shouldStop = false;
    this._stats = {
      total: 0,
      sent: 0,
      failed: 0,
      remaining: 0,
    };
  }

  /**
   * @returns {boolean}
   */
  isRunning() {
    return this._isRunning;
  }

  /**
   * @returns {{total: number, sent: number, failed: number, remaining: number}}
   */
  getStats() {
    return { ...this._stats };
  }

  /**
   * Start a bulk campaign.
   * @param {string[]} numbers list of sanitized international phone numbers
   * @param {string} message
   * @param {{minDelay: number, maxDelay: number}} delayOptions delay in seconds
   */
  async start(numbers, message, delayOptions = { minDelay: 120, maxDelay: 240 }) {
    if (this._isRunning) {
      throw new Error('A campaign is already running.');
    }
    if (!numbers || numbers.length === 0) {
      throw new Error('No phone numbers provided.');
    }
    if (!message || message.trim().length === 0) {
      throw new Error('Campaign message is empty.');
    }
    if (!this.whatsappClient.isReady()) {
      throw new Error('WhatsApp client is not connected.');
    }

    this._isRunning = true;
    this._shouldStop = false;
    this._stats = {
      total: numbers.length,
      sent: 0,
      failed: 0,
      remaining: numbers.length,
    };

    this.emit('started', { ...this._stats });

    const { minDelay, maxDelay } = delayOptions;

    for (let i = 0; i < numbers.length; i++) {
      if (this._shouldStop) {
        this.emit('status', 'Campaign stopped by user.');
        break;
      }

      const number = numbers[i];
      this.emit('status', `Sending to ${number} (${i + 1}/${numbers.length})...`);

      try {
        await this.whatsappClient.sendMessage(number, message.trim());
        this._stats.sent += 1;
        this.emit('messageSent', { number, index: i + 1 });
      } catch (err) {
        this._stats.failed += 1;
        this.emit('messageFailed', { number, index: i + 1, error: err.message });
      }

      this._stats.remaining = numbers.length - (i + 1);
      this.emit('progress', { ...this._stats });

      if (i < numbers.length - 1 && !this._shouldStop) {
        this.emit('status', `Waiting anti-ban delay (${minDelay}s-${maxDelay}s)...`);
        await randomDelay(minDelay, maxDelay);
      }
    }

    this._isRunning = false;
    this.emit('finished', { ...this._stats });
    this.emit('status', 'Campaign finished.');
  }

  /**
   * Request a graceful stop of the campaign.
   */
  stop() {
    if (this._isRunning) {
      this._shouldStop = true;
      this.emit('status', 'Stop requested. Finishing current message...');
    }
  }
}

module.exports = CampaignService;
