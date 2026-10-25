/**
 * Multi-account manager.
 *
 * Tracks WhatsApp accounts, their isolated session folders and per-account
 * send statistics. Switching the active account is a manual user action;
 * campaigns may additionally rotate automatically through linked accounts
 * (see campaign-service) using this manager's session state.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { parseProxyUrl } = require('./utils');

const DEFAULT_ACCOUNTS_FILE = path.join(__dirname, '..', 'accounts.json');
const DEFAULT_AUTH_DATA_PATH = path.join(__dirname, '..', '.wwebjs_auth');

class AccountManager extends EventEmitter {
  /**
   * @param {string} [accountsFile] path to the JSON persistence file
   * @param {string} [authDataPath] base folder holding session-<id> dirs
   */
  constructor(accountsFile = DEFAULT_ACCOUNTS_FILE, authDataPath = DEFAULT_AUTH_DATA_PATH) {
    super();
    this.accountsFile = accountsFile;
    this.authDataPath = authDataPath;
    this.accounts = [];
    this.activeId = null;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.accountsFile)) {
        const data = JSON.parse(fs.readFileSync(this.accountsFile, 'utf8'));
        this.accounts = Array.isArray(data.accounts) ? data.accounts : [];
        this.activeId = data.activeId || null;
        if (this.activeId && !this.accounts.some((a) => a.id === this.activeId)) {
          this.activeId = null;
        }
        if (this.activeId === null && this.accounts.length > 0) {
          this.activeId = this.accounts[0].id;
        }
      }
    } catch (err) {
      this.accounts = [];
      this.activeId = null;
    }
  }

  _save() {
    try {
      fs.writeFileSync(
        this.accountsFile,
        JSON.stringify({ accounts: this.accounts, activeId: this.activeId }, null, 2),
      );
    } catch (err) {
      // Ignore write errors; state stays in memory.
    }
  }

  _emitUpdated() {
    this.emit('updated', this.list());
  }

  /**
   * @returns {{activeId: string|null, accounts: Array<object>}}
   */
  list() {
    return {
      activeId: this.activeId,
      accounts: this.accounts.map((a) => ({
        ...a,
        proxy: a.proxy || null,
        stats: { ...a.stats },
        hasSession: this.hasSession(a.id),
      })),
    };
  }

  /**
   * Create a new account.
   * @param {string} label display name
   * @param {string} [fixedId] optional fixed id (used for seeding)
   * @returns {object} the created account
   */
  add(label, fixedId = null) {
    const account = {
      id: fixedId || `acct_${crypto.randomBytes(4).toString('hex')}`,
      label: (label || 'Account').trim() || 'Account',
      createdAt: new Date().toISOString(),
      proxy: null,
      stats: { sent: 0, failed: 0 },
    };
    this.accounts.push(account);
    if (!this.activeId) {
      this.activeId = account.id;
    }
    this._save();
    this._emitUpdated();
    return account;
  }

  /**
   * Remove an account and delete its session folder.
   * @param {string} id
   * @returns {boolean} true when the account existed
   */
  remove(id) {
    const index = this.accounts.findIndex((a) => a.id === id);
    if (index === -1) {
      return false;
    }
    this.accounts.splice(index, 1);
    if (this.activeId === id) {
      this.activeId = this.accounts.length > 0 ? this.accounts[0].id : null;
    }
    this.removeSessionDir(id);
    this._save();
    this._emitUpdated();
    return true;
  }

  /**
   * @param {string} id
   * @returns {object|null}
   */
  get(id) {
    return this.accounts.find((a) => a.id === id) || null;
  }

  /**
   * @returns {object|null}
   */
  getActive() {
    return this.activeId ? this.get(this.activeId) : null;
  }

  /**
   * Manually switch the active account.
   * @param {string} id
   * @returns {{success: boolean, error?: string}}
   */
  setActive(id) {
    if (!this.get(id)) {
      return { success: false, error: 'Account not found.' };
    }
    this.activeId = id;
    this._save();
    this._emitUpdated();
    return { success: true };
  }

  /**
   * Accounts that have a linked WhatsApp session on disk, in registration
   * order. Only these can take over mid-campaign without a fresh QR link.
   * @returns {Array<object>}
   */
  listLinked() {
    return this.accounts.filter((a) => this.hasSession(a.id));
  }

  /**
   * Set or clear the dedicated proxy of an account. The proxy is applied
   * automatically whenever this account connects (manual switch, rotation),
   * so one number always keeps its own IP.
   * @param {string} id
   * @param {string|null} rawProxy host:port or http://user:pass@host:port (null/'' clears)
   * @returns {{success: boolean, error?: string, proxy?: string|null}}
   */
  setProxy(id, rawProxy) {
    const account = this.get(id);
    if (!account) {
      return { success: false, error: 'Account not found.' };
    }
    if (rawProxy === null || rawProxy === undefined || String(rawProxy).trim() === '') {
      account.proxy = null;
      this._save();
      this._emitUpdated();
      return { success: true, proxy: null };
    }
    const parsed = parseProxyUrl(rawProxy);
    if (!parsed) {
      return { success: false, error: 'Invalid proxy. Use host:port or http://user:pass@host:port.' };
    }
    account.proxy = parsed.toString().replace(/\/+$/, '');
    this._save();
    this._emitUpdated();
    return { success: true, proxy: account.proxy };
  }

  /**
   * @param {string} id
   */
  recordSent(id) {
    const account = this.get(id);
    if (account) {
      account.stats.sent += 1;
      this._save();
    }
  }

  /**
   * @param {string} id
   */
  recordFailed(id) {
    const account = this.get(id);
    if (account) {
      account.stats.failed += 1;
      this._save();
    }
  }

  /**
   * Path of the isolated session folder for an account.
   * @param {string} id
   * @returns {string}
   */
  getSessionDir(id) {
    return path.join(this.authDataPath, `session-${id}`);
  }

  /**
   * Whether a linked WhatsApp session exists on disk for the account.
   * @param {string} id
   * @returns {boolean}
   */
  hasSession(id) {
    return fs.existsSync(this.getSessionDir(id));
  }

  /**
   * Delete the stored session folder for an account.
   * @param {string} id
   */
  removeSessionDir(id) {
    try {
      fs.rmSync(this.getSessionDir(id), { recursive: true, force: true });
    } catch (err) {
      // Ignore; folder may already be gone.
    }
  }
}

module.exports = AccountManager;
