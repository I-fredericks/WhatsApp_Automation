/**
 * License management service.
 * v1 uses a simple hardcoded VIP flag. A real implementation would call a
 * remote license server, validate keys, and manage expiry.
 */

const path = require('path');
const fs = require('fs');

const LICENSE_FILE = path.join(__dirname, '..', 'license.json');

class LicenseService {
  constructor() {
    this._status = {
      isActive: true,
      type: 'VIP Version',
      expiry: null,
      key: null,
    };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(LICENSE_FILE)) {
        const data = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
        this._status = {
          isActive: data.isActive ?? true,
          type: data.type || 'VIP Version',
          expiry: data.expiry || null,
          key: data.key || null,
        };
      }
    } catch (err) {
      // Keep default VIP status if file is corrupt.
    }
  }

  _save() {
    try {
      fs.writeFileSync(LICENSE_FILE, JSON.stringify(this._status, null, 2));
    } catch (err) {
      // Ignore write errors.
    }
  }

  /**
   * @returns {{isActive: boolean, type: string, expiry: string|null, key: string|null}}
   */
  getStatus() {
    return { ...this._status };
  }

  /**
   * Activate the license with a key.
   * @param {string} key
   * @returns {boolean}
   */
  activate(key) {
    // v1: any non-empty key activates VIP.
    if (key && key.trim().length > 0) {
      this._status.isActive = true;
      this._status.key = key.trim();
      this._save();
      return true;
    }
    return false;
  }

  /**
   * Check whether the application is licensed to run campaigns.
   * @returns {boolean}
   */
  isLicensed() {
    return this._status.isActive;
  }
}

module.exports = LicenseService;
