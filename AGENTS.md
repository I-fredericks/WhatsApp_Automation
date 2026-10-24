# Agent Notes

## Project

WhatsApp Bulk Campaign Tool v1 — a Node.js web dashboard for bulk WhatsApp messaging.

## Tech Stack

- Node.js v18+
- Express + Socket.IO for the real-time web dashboard
- whatsapp-web.js for WhatsApp Web automation
- OpenAI API for optional AI auto-reply
- Puppeteer (bundled with whatsapp-web.js, uses system Chromium)

## Commands

- `npm start` — start the server at http://localhost:3000
- `npm test` — run unit tests

## Key Files

- `main.js` — Express/Socket.IO server and wiring
- `src/whatsapp-client.js` — WhatsApp client wrapper
- `src/campaign-service.js` — bulk messaging logic with randomized delays
- `src/autoreply-service.js` — OpenAI auto-reply logic
- `src/license-service.js` — simple VIP license state
- `src/utils.js` — phone number parsing and delay helpers
- `renderer/` — static frontend (HTML/CSS/JS)

## Conventions

- CommonJS modules
- 2-space indentation
- Minimal changes; keep code simple and modular
- Use Socket.IO events prefixed by domain (`whatsapp:`, `campaign:`, `numbers:`, etc.)

## Environment Variables

- `PORT` — server port (default 3000)
- `PUPPETEER_EXECUTABLE_PATH` — path to system Chromium (default `/usr/bin/chromium`)
- `WWEBJS_WEB_VERSION` — pinned WhatsApp Web HTML version
