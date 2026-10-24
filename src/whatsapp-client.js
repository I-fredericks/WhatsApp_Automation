/**
 * WhatsApp client wrapper built on whatsapp-web.js.
 * Handles connection, QR code generation, sending messages, and incoming message events.
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const { EventEmitter } = require('events');
const { formatWhatsAppId } = require('./utils');

class WhatsAppClient extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this._isReady = false;
    this._isInitializing = false;
  }

  /**
   * Initialize the WhatsApp client and start listening for events.
   */
  initialize() {
    if (this._isInitializing || this.client) {
      return;
    }
    this._isInitializing = true;

    const webVersion = process.env.WWEBJS_WEB_VERSION || '2.3000.1051617046-alpha';

    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: 'whatsapp-bulk-campaign-tool',
        dataPath: './.wwebjs_auth',
      }),
      puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      },
      webVersionCache: {
        type: 'remote',
        remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${webVersion}.html`,
      },
    });

    this.client.on('qr', async (qr) => {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, { width: 256, margin: 2 });
        this.emit('qr', qrDataUrl);
      } catch (err) {
        this.emit('error', `QR generation failed: ${err.message}`);
      }
    });

    this.client.on('ready', () => {
      this._isReady = true;
      this._isInitializing = false;
      this.emit('status', 'WhatsApp connected and ready.');
      this.emit('ready');
    });

    this.client.on('authenticated', () => {
      this.emit('status', 'Authenticated. Restoring session...');
    });

    this.client.on('auth_failure', (msg) => {
      this._isReady = false;
      this._isInitializing = false;
      this.emit('error', `Authentication failure: ${msg}`);
    });

    this.client.on('disconnected', (reason) => {
      this._isReady = false;
      this._isInitializing = false;
      this.emit('status', `Disconnected: ${reason}`);
      this.emit('disconnected', reason);
      this.client = null;
    });

    this.client.on('message', (msg) => {
      this.emit('message', msg);
    });

    this.emit('status', 'Initializing WhatsApp client...');
    this.client.initialize().catch((err) => {
      this._isInitializing = false;
      this.emit('error', `Initialization error: ${err.message}`);
    });
  }

  /**
   * @returns {boolean}
   */
  isReady() {
    return this._isReady;
  }

  /**
   * Send a text message to a phone number.
   * @param {string} phoneNumber international number without + or @c.us
   * @param {string} text
   * @returns {Promise<object>}
   */
  async sendMessage(phoneNumber, text) {
    if (!this._isReady) {
      throw new Error('WhatsApp client is not ready.');
    }
    const chatId = formatWhatsAppId(phoneNumber);
    return this.client.sendMessage(chatId, text);
  }

  /**
   * Disconnect and clean up the client.
   */
  async destroy() {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (err) {
        // ignore
      }
      this.client = null;
      this._isReady = false;
      this._isInitializing = false;
    }
  }
}

module.exports = WhatsAppClient;
