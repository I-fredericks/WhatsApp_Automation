/**
 * WhatsApp client wrapper built on whatsapp-web.js.
 * Handles connection via QR code or phone-number pairing, proxy support,
 * sending messages, and incoming message events.
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const proxyChain = require('proxy-chain');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { formatWhatsAppId, sanitizePhoneNumber, parseProxyUrl } = require('./utils');

const CLIENT_ID = 'whatsapp-bulk-campaign-tool';
const DATA_PATH = './.wwebjs_auth';
class WhatsAppClient extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this._isReady = false;
    this._isInitializing = false;
    this._proxyUrl = null;
    this._anonymizedProxyUrl = null;
  }

  /**
   * Set the proxy to use for the next connection.
   * @param {string|null} rawProxy e.g. host:port or http://user:pass@host:port (null/'' clears)
   * @returns {{success: boolean, error?: string, proxy?: string|null}}
   */
  setProxy(rawProxy) {
    if (rawProxy === null || rawProxy === undefined || String(rawProxy).trim() === '') {
      this._proxyUrl = null;
      this.emit('status', 'Proxy cleared. Applies to next connection.');
      return { success: true, proxy: null };
    }

    const parsed = parseProxyUrl(rawProxy);
    if (!parsed) {
      return {
        success: false,
        error: 'Invalid proxy. Use host:port or http://user:pass@host:port.',
      };
    }

    this._proxyUrl = parsed.toString();
    this.emit('status', `Proxy set to ${parsed.hostname}:${parsed.port}. Applies to next connection.`);
    return { success: true, proxy: this._proxyUrl };
  }

  /**
   * @returns {string|null}
   */
  getProxy() {
    return this._proxyUrl;
  }

  /**
   * Resolve the proxy for Chromium launch args. For proxies with credentials,
   * spin up a local anonymized proxy (Chromium cannot handle proxy auth).
   * @returns {Promise<string|null>} proxy URL for --proxy-server or null
   */
  async _resolveProxyArg() {
    if (!this._proxyUrl) {
      return null;
    }

    // Close any leftover anonymized proxy from a previous run.
    await this._closeAnonymizedProxy();

    const parsed = new URL(this._proxyUrl);
    // Chromium's --proxy-server only accepts scheme//host:port — any path or
    // trailing slash makes it silently ignore the proxy.
    const originForm = `${parsed.protocol}//${parsed.host}`;

    if (!parsed.username && !parsed.password) {
      return originForm;
    }

    try {
      this._anonymizedProxyUrl = await proxyChain.anonymizeProxy({
        url: this._proxyUrl,
        port: 0,
      });
      return this._anonymizedProxyUrl.replace(/\/+$/, '');
    } catch (err) {
      this._anonymizedProxyUrl = null;
      throw new Error(`Failed to set up authenticated proxy: ${err.message}`);
    }
  }

  /**
   * Close the local anonymized proxy, if one is running.
   */
  async _closeAnonymizedProxy() {
    if (this._anonymizedProxyUrl) {
      try {
        await proxyChain.closeAnonymizedProxy(this._anonymizedProxyUrl, true);
      } catch (err) {
        // ignore
      }
      this._anonymizedProxyUrl = null;
    }
  }

  /**
   * Create the underlying whatsapp-web.js Client.
   * @param {string} accountId isolated session/client id for the account
   * @param {string|null} pairWithPhoneNumber
   * @param {string|null} proxyArg
   * @returns {Client}
   */
  _createClient(accountId, pairWithPhoneNumber = null, proxyArg = null, authTimeoutMs = null) {
    const webVersion = process.env.WWEBJS_WEB_VERSION || '2.3000.1051617046-alpha';

    const puppeteerArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
    if (proxyArg) {
      puppeteerArgs.push(`--proxy-server=${proxyArg}`);
    }

    const options = {
      authStrategy: new LocalAuth({
        clientId: accountId,
        dataPath: DATA_PATH,
      }),
      // Page load is slower through proxies; give the WhatsApp auth store
      // more time to boot than the library's 30s default.
      authTimeoutMs: authTimeoutMs || Number(process.env.WWEBJS_AUTH_TIMEOUT) || 120000,
      puppeteer: {
        args: puppeteerArgs,
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      },
      webVersionCache: {
        // Local cache seeded with the pinned version (and auto-persisted by
        // the library after each successful load) so a GitHub outage can
        // never block or crash connections.
        type: 'local',
      },
    };

    if (pairWithPhoneNumber) {
      options.pairWithPhoneNumber = {
        phoneNumber: pairWithPhoneNumber,
        showNotification: true,
        intervalMs: 180000,
      };
    }

    return new Client(options);
  }

  _attachCommonListeners() {
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
      this._closeAnonymizedProxy();
    });

    this.client.on('message', (msg) => {
      this.emit('message', msg);
    });
  }

  /**
   * Attach a rejection handler that swallows teardown races in which the
   * browser is destroyed while initialization is still running, and release
   * the browser/profile lock when initialization fails.
   * @param {Promise} initPromise
   */
  _handleInitRejection(initPromise) {
    initPromise.catch(async (err) => {
      this._isInitializing = false;
      if (err && (err.name === 'TargetCloseError' || /Target closed/i.test(err.message || ''))) {
        this.emit('status', 'Initialization aborted: browser was closed.');
        return;
      }
      const detail = err instanceof Error
        ? err.message
        : JSON.stringify(err, Object.getOwnPropertyNames(err || {}));

      // Capture diagnostics to help debug connect failures.
      try {
        const page = this.client && this.client.pupPage;
        if (page) {
          const debugDir = path.join(process.cwd(), '.wwebjs_debug');
          fs.mkdirSync(debugDir, { recursive: true });
          // eslint-disable-next-line no-console
          console.error(`[diagnostic] init failed. Page URL: ${page.url()}`);
          await page.screenshot({ path: path.join(debugDir, 'init-failure.png') });
        }
      } catch (diagErr) {
        // ignore diagnostic failures
      }

      this.emit('error', `Initialization error: ${detail}`);
      // Release the browser and profile dir so the next attempt can start.
      await this.destroy();
      this.emit('disconnected', 'initialization failed');
    });
  }

  /**
   * Initialize the WhatsApp client for the given account and show a QR code
   * for linking (or restore the saved session automatically).
   * @param {string} accountId isolated session id of the account to connect
   * @returns {Promise<boolean>} true when initialization started
   */
  async initialize(accountId) {
    if (!accountId) {
      this.emit('error', 'No active account. Create one first.');
      return false;
    }
    if (this._isInitializing) {
      this.emit('status', 'Connection attempt already in progress.');
      return false;
    }
    if (this.client) {
      this.emit('status', 'Client already exists. Disconnect first.');
      return false;
    }
    this._isInitializing = true;
    this._accountId = accountId;

    try {
      const proxyArg = await this._resolveProxyArg();
      if (proxyArg) {
        this.emit('status', `Connecting through proxy ${proxyArg}...`);
      }
      this.client = this._createClient(accountId, null, proxyArg);

      this.client.on('qr', async (qr) => {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, { width: 256, margin: 2 });
          this.emit('qr', qrDataUrl);
        } catch (err) {
          this.emit('error', `QR generation failed: ${err.message}`);
        }
      });

      this._attachCommonListeners();

      this.emit('status', 'Initializing WhatsApp client (QR mode)...');
      this._handleInitRejection(this.client.initialize());
      return true;
    } catch (err) {
      this._isInitializing = false;
      this.emit('error', `Initialization error: ${err.message}`);
      return false;
    }
  }

  /**
   * Initialize the WhatsApp client for the given account and request a
   * pairing code for the given phone number. The user enters this code
   * inside WhatsApp on their phone.
   * @param {string} accountId isolated session id of the account to connect
   * @param {string} phoneNumber international number without + or spaces
   * @returns {Promise<boolean>} true when initialization started
   */
  async initializeWithPhoneNumber(accountId, phoneNumber) {
    if (!accountId) {
      this.emit('error', 'No active account. Create one first.');
      return false;
    }
    const cleanNumber = sanitizePhoneNumber(phoneNumber);
    if (!cleanNumber) {
      this.emit('error', 'Invalid phone number for pairing.');
      return false;
    }

    if (this._isInitializing) {
      this.emit('status', 'Connection attempt already in progress.');
      return false;
    }
    if (this.client) {
      this.emit('status', 'Client already exists. Disconnect first.');
      return false;
    }
    this._isInitializing = true;
    this._accountId = accountId;

    try {
      const proxyArg = await this._resolveProxyArg();
      if (proxyArg) {
        this.emit('status', `Connecting through proxy ${proxyArg}...`);
      }
      // Pairing needs the user to type the code on their phone — allow at
      // least 5 minutes before the auth store times out.
      this.client = this._createClient(
        accountId,
        cleanNumber,
        proxyArg,
        Math.max(Number(process.env.WWEBJS_AUTH_TIMEOUT) || 0, 300000),
      );

      this.client.on('code', (code) => {
        this.emit('pairingCode', code);
      });

      this._attachCommonListeners();

      this.emit('status', `Requesting pairing code for ${cleanNumber}...`);
      this._handleInitRejection(this.client.initialize());
      return true;
    } catch (err) {
      this._isInitializing = false;
      this.emit('error', `Initialization error: ${err.message}`);
      return false;
    }
  }

  /**
   * @returns {boolean}
   */
  isReady() {
    return this._isReady;
  }

  /**
   * @returns {string|null} account id this client was initialized with
   */
  getActiveAccountId() {
    return this._accountId || null;
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
    // Resolve the real chat JID first. Newer WhatsApp Web builds migrate
    // chats to LID ids and throw "No LID for user" for raw @c.us ids; the
    // onWhatsApp lookup returns the correct JID and refreshes that mapping.
    const numberId = await this.client.getNumberId(phoneNumber);
    if (!numberId) {
      throw new Error(`Number ${phoneNumber} is not registered on WhatsApp.`);
    }
    return this.client.sendMessage(numberId._serialized, text);
  }

  /**
   * Disconnect and clean up the client (session stays on disk).
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
    await this._closeAnonymizedProxy();
  }

  /**
   * Log out from WhatsApp (invalidates the session server-side), clean up,
   * and delete the local session so the next connect requires a fresh link.
   */
  async logout() {
    if (this.client && this._isReady) {
      try {
        await this.client.logout();
      } catch (err) {
        // Session may already be invalid; continue clearing local data.
      }
    }
    await this.destroy();

    const accountId = this._accountId || CLIENT_ID;
    const sessionDir = path.join(process.cwd(), DATA_PATH, `session-${accountId}`);
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      this.emit('status', 'Logged out and cleared local session.');
    } catch (err) {
      this.emit('error', `Failed to clear session data: ${err.message}`);
    }
  }
}

module.exports = WhatsAppClient;
