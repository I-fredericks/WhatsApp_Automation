/**
 * WhatsApp Bulk Campaign Tool - v1 Server
 *
 * Serves a web-based dashboard and runs the WhatsApp automation backend.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const WhatsAppClient = require('./src/whatsapp-client');
const CampaignService = require('./src/campaign-service');
const AutoReplyService = require('./src/autoreply-service');
const LicenseService = require('./src/license-service');
const AccountManager = require('./src/account-manager');
const { parseNumberList } = require('./src/utils');

const PORT = process.env.PORT || 3000;
// Bind to localhost by default so the dashboard is not reachable from the
// network. Set HOST=0.0.0.0 explicitly to expose it (not recommended).
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Cap single socket payloads; none of our events need large frames.
  maxHttpBufferSize: 1e6,
});

const whatsappClient = new WhatsAppClient();
const campaignService = new CampaignService(whatsappClient);
const autoReplyService = new AutoReplyService(whatsappClient);
const licenseService = new LicenseService();
const accountManager = new AccountManager();

// Seed a first account bound to the legacy session id so an existing
// linked session keeps working after the upgrade.
if (accountManager.list().accounts.length === 0) {
  accountManager.add('Account 1', 'whatsapp-bulk-campaign-tool');
}

let currentNumbers = [];
let currentCampaignMessage = '';
let currentDelayOptions = { minDelay: 120, maxDelay: 240 };
let currentRotationOptions = { enabled: false, maxPerAccount: 50, switchPauseSeconds: 60 };

const MAX_CAMPAIGN_MESSAGE_CHARS = 4096;
const MAX_NUMBERS = 10000;
const clampInt = (value, min, max, fallback) => {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
};

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  next();
});
app.use(express.static(path.join(__dirname, 'renderer')));
app.use(express.json({ limit: '256kb' }));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'renderer', 'index.html'));
});

function broadcast(channel, payload) {
  io.emit(channel, payload);
}

/**
 * Resolve when the WhatsApp client fires 'ready', or reject on disconnect
 * or after the auth timeout. Used to hold the campaign until a freshly
 * rotated account is actually connected.
 */
function waitForClientReady(timeoutMs = Number(process.env.WWEBJS_AUTH_TIMEOUT) || 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Account did not connect in time.'));
    }, timeoutMs);
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onDisconnected = () => {
      cleanup();
      reject(new Error('Account connection failed.'));
    };
    function cleanup() {
      clearTimeout(timer);
      whatsappClient.off('ready', onReady);
      whatsappClient.off('disconnected', onDisconnected);
    }
    whatsappClient.once('ready', onReady);
    whatsappClient.once('disconnected', onDisconnected);
  });
}

/**
 * Rotate the sender to the next linked account (round-robin in registration
 * order), releasing the current browser first. Resolves with the new account,
 * or null when no other linked account exists (campaign keeps going with the
 * current one). Throws when every candidate fails to connect.
 * @param {string|null} currentId id of the account currently sending
 * @returns {Promise<object|null>}
 */
async function rotateToNextAccount(currentId) {
  const linked = accountManager.listLinked();
  if (linked.length === 0) {
    broadcast('status', 'Rotation: no linked account available. Continuing with current account.');
    return null;
  }
  const currentIndex = linked.findIndex((a) => a.id === currentId);
  const ordered = currentIndex === -1
    ? linked.filter((a) => a.id !== currentId)
    : [...linked.slice(currentIndex + 1), ...linked.slice(0, currentIndex)];

  let lastError = null;
  for (const target of ordered) {
    try {
      broadcast('status', `Rotation: switching to "${target.label}"...`);
      // Release the current browser (and its profile lock) first.
      await whatsappClient.destroy();
      broadcast('whatsapp:ready', false);

      // The new sender goes online through its own dedicated proxy.
      whatsappClient.setProxy(target.proxy || null);
      accountManager.setActive(target.id);
      broadcast('accounts:updated', accountManager.list());

      const started = await whatsappClient.initialize(target.id);
      if (!started) {
        throw new Error('connection attempt did not start.');
      }
      await waitForClientReady();
      broadcast('status', `Rotation complete. Now sending with "${target.label}".`);
      return target;
    } catch (err) {
      lastError = err;
      broadcast('status', `Rotation: could not connect "${target.label}" (${err.message}).`);
    }
  }
  throw new Error(`no linked account could be connected${lastError ? ` (${lastError.message})` : ''}.`);
}

function setupEventForwarding() {
  whatsappClient.on('qr', (qrDataUrl) => broadcast('whatsapp:qr', qrDataUrl));
  whatsappClient.on('pairingCode', (code) => broadcast('whatsapp:pairingCode', code));
  whatsappClient.on('ready', () => broadcast('whatsapp:ready', true));
  whatsappClient.on('disconnected', (reason) => {
    broadcast('whatsapp:ready', false);
    broadcast('status', `Disconnected: ${reason}`);
    campaignService.stop();
  });
  whatsappClient.on('status', (msg) => broadcast('status', msg));
  whatsappClient.on('error', (msg) => broadcast('error', msg));

  campaignService.on('started', (stats) => broadcast('campaign:started', stats));
  campaignService.on('progress', (stats) => broadcast('campaign:progress', stats));
  campaignService.on('finished', (stats) => broadcast('campaign:finished', stats));
  campaignService.on('error', (msg) => broadcast('error', msg));
  campaignService.on('accountSwitched', ({ afterMessages }) => {
    const active = accountManager.getActive();
    broadcast('status', `Rotated to "${active ? active.label : '?'}" after ${afterMessages} messages.`);
  });
  campaignService.on('messageSent', ({ number, index }) => {
    const active = accountManager.getActive();
    if (active) {
      accountManager.recordSent(active.id);
    }
    broadcast('status', `Sent to ${number} (${index})`);
  });
  campaignService.on('messageFailed', ({ number, index, error }) => {
    const active = accountManager.getActive();
    if (active) {
      accountManager.recordFailed(active.id);
    }
    broadcast('status', `Failed to send to ${number} (${index}): ${error}`);
  });
  campaignService.on('status', (msg) => broadcast('status', msg));

  autoReplyService.on('status', (msg) => broadcast('status', msg));
  autoReplyService.on('replied', ({ to }) => broadcast('status', `AI replied to ${to}`));
  autoReplyService.on('error', (msg) => broadcast('error', msg));
}

function setupSocketHandlers() {
  io.on('connection', (socket) => {
    // Send current state on connect
    socket.emit('app:license', licenseService.getStatus());
    socket.emit('whatsapp:ready', whatsappClient.isReady());
    socket.emit('campaign:progress', campaignService.getStats());
    socket.emit('numbers:updated', currentNumbers);
    const connectedAccount = accountManager.getActive();
    socket.emit('whatsapp:proxy', connectedAccount ? connectedAccount.proxy || null : null);
    socket.emit('accounts:updated', accountManager.list());
    socket.emit('campaign:rotation', currentRotationOptions);
    socket.emit('autoreply:providers', AutoReplyService.getProviders());
    socket.emit('autoreply:config', autoReplyService.getConfig());

    socket.on('app:activate-license', (key, callback) => {
      const ok = licenseService.activate(key);
      callback({ success: ok, license: licenseService.getStatus() });
      if (ok) broadcast('app:license', licenseService.getStatus());
    });

    socket.on('whatsapp:connect', async (_payload, callback) => {
      const cb = typeof callback === 'function' ? callback : () => {};
      if (whatsappClient.isReady()) {
        return cb({ success: false, error: 'WhatsApp is already connected.' });
      }
      const active = accountManager.getActive();
      if (!active) {
        return cb({ success: false, error: 'No active account. Add one first.' });
      }
      whatsappClient.setProxy(active.proxy || null);
      const started = await whatsappClient.initialize(active.id);
      cb({ success: started, error: started ? undefined : 'Connection attempt not started.' });
    });

    socket.on('whatsapp:connect-phone', async (payload, callback) => {
      const cb = typeof callback === 'function' ? callback : () => {};
      if (whatsappClient.isReady()) {
        return cb({ success: false, error: 'WhatsApp is already connected.' });
      }
      const active = accountManager.getActive();
      if (!active) {
        return cb({ success: false, error: 'No active account. Add one first.' });
      }
      const phoneNumber = typeof payload === 'string' ? payload : payload?.phoneNumber;
      whatsappClient.setProxy(active.proxy || null);
      const started = await whatsappClient.initializeWithPhoneNumber(active.id, phoneNumber);
      cb({
        success: started,
        error: started ? undefined : 'Pairing attempt not started (invalid number or busy).',
      });
    });

    socket.on('whatsapp:set-proxy', (proxyString, callback) => {
      const active = accountManager.getActive();
      if (!active) {
        return callback({ success: false, error: 'No active account. Add one first.' });
      }
      // Proxies are per account ("1 number = 1 proxy"); the wrapper applies
      // the active account's proxy on its next connection.
      const result = accountManager.setProxy(active.id, String(proxyString || '').slice(0, 2048));
      if (result.success) {
        broadcast('accounts:updated', accountManager.list());
        whatsappClient.setProxy(result.proxy);
      }
      callback(result);
    });

    socket.on('whatsapp:get-proxy', (callback) => {
      const active = accountManager.getActive();
      callback({ proxy: active ? active.proxy || null : null });
    });

    socket.on('whatsapp:logout', async (_payload, callback) => {
      const cb = typeof callback === 'function' ? callback : () => {};
      campaignService.stop();
      await whatsappClient.logout();
      const active = accountManager.getActive();
      if (active) {
        accountManager.removeSessionDir(active.id);
      }
      broadcast('whatsapp:ready', false);
      broadcast('accounts:updated', accountManager.list());
      cb({ success: true });
    });

    socket.on('accounts:list', (callback) => {
      callback(accountManager.list());
    });

    socket.on('accounts:add', (payload, callback) => {
      const rawLabel = typeof payload === 'string' ? payload : payload?.label;
      const label = String(rawLabel || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);
      const account = accountManager.add(label || `Account ${accountManager.list().accounts.length + 1}`);
      callback({ success: true, account });
    });

    socket.on('accounts:remove', (payload, callback) => {
      const id = typeof payload === 'string' ? payload : payload?.id;
      const wasActive = accountManager.getActive()?.id === id;
      const removed = accountManager.remove(id);
      if (removed && wasActive) {
        campaignService.stop();
        whatsappClient.destroy().then(() => {
          broadcast('whatsapp:ready', false);
          broadcast('accounts:updated', accountManager.list());
        });
      }
      callback({ success: removed, error: removed ? undefined : 'Account not found.' });
    });

    socket.on('accounts:switch', async (payload, callback) => {
      const cb = typeof callback === 'function' ? callback : () => {};
      const id = typeof payload === 'string' ? payload : payload?.id;
      if (campaignService.isRunning()) {
        return cb({ success: false, error: 'Stop the running campaign before switching accounts.' });
      }
      const target = accountManager.get(id);
      if (!target) {
        return cb({ success: false, error: 'Account not found.' });
      }
      if (accountManager.getActive()?.id === id) {
        return cb({ success: false, error: 'Account is already active.' });
      }

      // Release the current browser (and its profile lock) first.
      await whatsappClient.destroy();
      broadcast('whatsapp:ready', false);

      // "1 number = 1 proxy": the target account connects through its own IP.
      whatsappClient.setProxy(target.proxy || null);
      accountManager.setActive(id);
      broadcast('accounts:updated', accountManager.list());

      // Auto-restore when the target account already has a linked session.
      if (accountManager.hasSession(id)) {
        await whatsappClient.initialize(id);
        cb({ success: true, autoRestored: true });
      } else {
        broadcast('status', `Switched to "${target.label}". Connect (QR or pairing) to link this account.`);
        cb({ success: true, autoRestored: false });
      }
    });

    socket.on('whatsapp:disconnect', async () => {
      campaignService.stop();
      await whatsappClient.destroy();
      broadcast('whatsapp:ready', false);
    });

    socket.on('numbers:import', (rawText, callback) => {
      const parsed = parseNumberList(rawText).slice(0, MAX_NUMBERS);
      if (parsed.length >= MAX_NUMBERS) {
        return callback({ success: false, error: `Number list is limited to ${MAX_NUMBERS} numbers.` });
      }
      currentNumbers = parsed;
      callback({ success: true, count: currentNumbers.length, numbers: currentNumbers });
      broadcast('numbers:updated', currentNumbers);
    });

    socket.on('numbers:add', (rawNumbers, callback) => {
      const newNumbers = parseNumberList(rawNumbers);
      if (currentNumbers.length + newNumbers.length > MAX_NUMBERS) {
        return callback({ success: false, error: `Number list is limited to ${MAX_NUMBERS} numbers.` });
      }
      currentNumbers = [...new Set([...currentNumbers, ...newNumbers])];
      callback({ success: true, count: currentNumbers.length, added: newNumbers.length, numbers: currentNumbers });
      broadcast('numbers:updated', currentNumbers);
    });

    socket.on('numbers:clear', (callback) => {
      currentNumbers = [];
      callback({ success: true, count: 0 });
      broadcast('numbers:updated', currentNumbers);
    });

    socket.on('campaign:set-message', (message, callback) => {
      currentCampaignMessage = String(message || '').slice(0, MAX_CAMPAIGN_MESSAGE_CHARS);
      callback({ success: true });
    });

    socket.on('campaign:set-delay', (options, callback) => {
      currentDelayOptions = {
        minDelay: clampInt(options && options.minDelay, 1, 3600, 120),
        maxDelay: clampInt(options && options.maxDelay, 1, 3600, 240),
      };
      if (currentDelayOptions.minDelay > currentDelayOptions.maxDelay) {
        currentDelayOptions.maxDelay = currentDelayOptions.minDelay;
      }
      callback({ success: true, options: currentDelayOptions });
    });

    socket.on('campaign:set-rotation', (options, callback) => {
      currentRotationOptions = {
        enabled: Boolean(options && options.enabled),
        maxPerAccount: clampInt(options && options.maxPerAccount, 1, 100000, 50),
        switchPauseSeconds: clampInt(options && options.switchPauseSeconds, 0, 3600, 60),
      };
      callback({ success: true, options: currentRotationOptions });
    });

    socket.on('campaign:start', async (callback) => {
      if (!licenseService.isLicensed()) {
        return callback({ success: false, error: 'VIP license is not active.' });
      }
      if (!whatsappClient.isReady()) {
        return callback({ success: false, error: 'WhatsApp is not connected.' });
      }
      if (currentNumbers.length === 0) {
        return callback({ success: false, error: 'No numbers imported.' });
      }
      if (!currentCampaignMessage.trim()) {
        return callback({ success: false, error: 'Campaign message is empty.' });
      }

      callback({ success: true });

      const rotateAccount = currentRotationOptions.enabled
        ? async () => {
            const currentId = whatsappClient.getActiveAccountId()
              || (accountManager.getActive() ? accountManager.getActive().id : null);
            await rotateToNextAccount(currentId);
          }
        : null;

      campaignService
        .start(currentNumbers, currentCampaignMessage, currentDelayOptions, currentRotationOptions, rotateAccount)
        .catch((err) => broadcast('error', err.message));
    });

    socket.on('message:send', async (payload, callback) => {
      const cb = typeof callback === 'function' ? callback : () => {};
      const number = typeof payload === 'string' ? payload : payload?.number;
      const text = typeof payload === 'string' ? undefined : payload?.text;
      if (!number || !text) {
        return cb({ success: false, error: 'number and text are required.' });
      }
      if (!whatsappClient.isReady()) {
        return cb({ success: false, error: 'WhatsApp is not connected.' });
      }
      try {
        const msg = await whatsappClient.sendMessage(parseNumberList(number)[0], text);
        const active = accountManager.getActive();
        if (active) {
          accountManager.recordSent(active.id);
          broadcast('accounts:updated', accountManager.list());
        }
        cb({ success: true, messageId: msg && msg.id ? msg.id._serialized || msg.id.id : null });
      } catch (err) {
        const active = accountManager.getActive();
        if (active) {
          accountManager.recordFailed(active.id);
          broadcast('accounts:updated', accountManager.list());
        }
        cb({ success: false, error: err.message });
      }
    });

    socket.on('campaign:stop', () => {
      campaignService.stop();
    });

    socket.on('autoreply:configure', (options, callback) => {
      const result = autoReplyService.configure(options || {});
      if (result.success) {
        if (result.config.enabled) {
          autoReplyService.start();
        } else {
          autoReplyService.stop();
        }
      }
      callback(result);
    });
  });
}

setupEventForwarding();
setupSocketHandlers();

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`WhatsApp Bulk Campaign Tool running at http://${HOST}:${PORT}`);
  if (HOST !== '127.0.0.1') {
    // eslint-disable-next-line no-console
    console.warn('WARNING: dashboard is exposed beyond localhost. Anyone who can reach this host can control the tool.');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // eslint-disable-next-line no-console
    console.error(`Port ${PORT} is already in use. Another instance may be running.`);
  } else {
    // eslint-disable-next-line no-console
    console.error('Server error:', err.message);
  }
  process.exit(1);
});

process.on('SIGINT', async () => {
  await whatsappClient.destroy();
  autoReplyService.stop();
  process.exit(0);
});
