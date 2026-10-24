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
const { parseNumberList } = require('./src/utils');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const whatsappClient = new WhatsAppClient();
const campaignService = new CampaignService(whatsappClient);
const autoReplyService = new AutoReplyService(whatsappClient);
const licenseService = new LicenseService();

let currentNumbers = [];
let currentCampaignMessage = '';
let currentDelayOptions = { minDelay: 120, maxDelay: 240 };

app.use(express.static(path.join(__dirname, 'renderer')));
app.use(express.json());

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'renderer', 'index.html'));
});

function broadcast(channel, payload) {
  io.emit(channel, payload);
}

function setupEventForwarding() {
  whatsappClient.on('qr', (qrDataUrl) => broadcast('whatsapp:qr', qrDataUrl));
  whatsappClient.on('ready', () => broadcast('whatsapp:ready', true));
  whatsappClient.on('disconnected', (reason) => {
    broadcast('whatsapp:ready', false);
    broadcast('status', `Disconnected: ${reason}`);
  });
  whatsappClient.on('status', (msg) => broadcast('status', msg));
  whatsappClient.on('error', (msg) => broadcast('error', msg));

  campaignService.on('started', (stats) => broadcast('campaign:started', stats));
  campaignService.on('progress', (stats) => broadcast('campaign:progress', stats));
  campaignService.on('finished', (stats) => broadcast('campaign:finished', stats));
  campaignService.on('messageSent', ({ number, index }) => {
    broadcast('status', `Sent to ${number} (${index})`);
  });
  campaignService.on('messageFailed', ({ number, index, error }) => {
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

    socket.on('app:activate-license', (key, callback) => {
      const ok = licenseService.activate(key);
      callback({ success: ok, license: licenseService.getStatus() });
      if (ok) broadcast('app:license', licenseService.getStatus());
    });

    socket.on('whatsapp:connect', () => {
      if (!whatsappClient.isReady()) {
        whatsappClient.initialize();
      }
    });

    socket.on('whatsapp:disconnect', async () => {
      await whatsappClient.destroy();
      broadcast('whatsapp:ready', false);
    });

    socket.on('numbers:import', (rawText, callback) => {
      currentNumbers = parseNumberList(rawText);
      callback({ success: true, count: currentNumbers.length, numbers: currentNumbers });
      broadcast('numbers:updated', currentNumbers);
    });

    socket.on('numbers:clear', (callback) => {
      currentNumbers = [];
      callback({ success: true, count: 0 });
      broadcast('numbers:updated', currentNumbers);
    });

    socket.on('campaign:set-message', (message, callback) => {
      currentCampaignMessage = message || '';
      callback({ success: true });
    });

    socket.on('campaign:set-delay', (options, callback) => {
      currentDelayOptions = {
        minDelay: Number(options.minDelay) || 120,
        maxDelay: Number(options.maxDelay) || 240,
      };
      callback({ success: true, options: currentDelayOptions });
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

      campaignService
        .start(currentNumbers, currentCampaignMessage, currentDelayOptions)
        .catch((err) => broadcast('error', err.message));
    });

    socket.on('campaign:stop', () => {
      campaignService.stop();
    });

    socket.on('autoreply:configure', (options, callback) => {
      autoReplyService.configure(options);
      autoReplyService.start();
      callback({ success: true, config: autoReplyService.getConfig() });
    });
  });
}

setupEventForwarding();
setupSocketHandlers();

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`WhatsApp Bulk Campaign Tool running at http://localhost:${PORT}`);
});

process.on('SIGINT', async () => {
  await whatsappClient.destroy();
  autoReplyService.stop();
  process.exit(0);
});
