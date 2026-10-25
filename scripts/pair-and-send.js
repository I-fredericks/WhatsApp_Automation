/**
 * Pair this tool with a WhatsApp number and send a test message.
 *
 * Usage:
 *   node scripts/pair-and-send.js <linkNumber> <targetNumber> [message] [--proxy http://host:port]
 */

const { io } = require('socket.io-client');
const proxyChain = require('proxy-chain');

const SERVER_URL = 'http://localhost:3000';

function parseArgs() {
  const args = process.argv.slice(2);
  const positional = [];
  const options = { proxy: null, timeoutMs: 600000 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--proxy') {
      options.proxy = args[i + 1];
      i++;
    } else {
      positional.push(args[i]);
    }
  }
  return {
    linkNumber: positional[0],
    targetNumber: positional[1],
    message: positional[2] || 'Hello! This is a test message from WhatsApp Bulk Campaign Tool v1.',
    ...options,
  };
}

async function main() {
  const { linkNumber, targetNumber, message, proxy, timeoutMs } = parseArgs();

  if (!linkNumber || !targetNumber) {
    console.error('Usage: node scripts/pair-and-send.js <linkNumber> <targetNumber> [message] [--proxy http://host:port]');
    process.exit(1);
  }

  let localProxy = null;
  if (proxy) {
    localProxy = new proxyChain.Server({ port: 0 });
    await localProxy.listen();
    console.log(`[proxy] local forward proxy listening on 127.0.0.1:${localProxy.port}`);
  }

  const socket = io(SERVER_URL);

  const cleanup = async (code) => {
    try { socket.disconnect(); } catch (e) {}
    if (localProxy) {
      await localProxy.close(true).catch(() => {});
    }
    process.exit(code);
  };

  socket.on('connect', () => {
    console.log(`[app] connected to dashboard server (${socket.id})`);

    const startPairing = () => {
      console.log(`[pair] requesting pairing code for +${linkNumber}...`);
      console.log('[pair] On your phone open: WhatsApp > Settings > Linked devices > Link a device > Link with phone number instead');
      socket.emit('whatsapp:connect-phone', { phoneNumber: linkNumber }, (r) => {
        if (!r.success) {
          console.error(`[pair] failed: ${r.error}`);
          cleanup(1);
        }
      });
    };

    if (localProxy) {
      socket.emit('whatsapp:set-proxy', `http://127.0.0.1:${localProxy.port}`, (r) => {
        console.log(`[proxy] set: ${r.success ? r.proxy : r.error}`);
        startPairing();
      });
    } else {
      startPairing();
    }
  });

  socket.on('whatsapp:pairingCode', (code) => {
    console.log('');
    console.log('==================================================');
    console.log(`  PAIRING CODE:  ${code}`);
    console.log('  Enter it on your phone NOW (valid ~3 minutes).');
    console.log('==================================================');
    console.log('');
  });

  socket.on('whatsapp:ready', async (ready) => {
    if (!ready) {
      return;
    }
    console.log(`[wa] WhatsApp linked and READY as +${linkNumber}`);
    console.log(`[send] sending test message to +${targetNumber}...`);

    socket.emit('message:send', { number: targetNumber, text: message }, async (r) => {
      if (r.success) {
        console.log(`[send] SUCCESS - delivered to WhatsApp (id: ${r.messageId})`);
      } else {
        console.error(`[send] FAILED: ${r.error}`);
      }
      if (localProxy) {
        console.log('[note] proxy hop closes with this script; the browser session will drop. Reconnect from the dashboard afterwards.');
        await new Promise((res) => setTimeout(res, 3000));
        await cleanup(r.success ? 0 : 1);
      } else {
        console.log('[done] session stays connected on the server. Open http://localhost:3000 to use the dashboard.');
        await cleanup(r.success ? 0 : 1);
      }
    });
  });

  socket.on('status', (m) => console.log(`[status] ${m}`));
  socket.on('error', (m) => console.error(`[error] ${m}`));
  socket.on('connect_error', (err) => {
    console.error(`[app] connection error: ${err.message}`);
    cleanup(1);
  });

  setTimeout(async () => {
    console.error('[timeout] gave up waiting for pairing/ready.');
    await cleanup(1);
  }, timeoutMs);
}

main().catch((err) => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
