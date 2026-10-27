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
- `src/whatsapp-client.js` — WhatsApp client wrapper (per-account sessions)
- `src/account-manager.js` — multi-account registry, session dirs, per-account stats
- `src/campaign-service.js` — bulk messaging logic with randomized delays
- `src/autoreply-service.js` — AI auto-reply via OpenAI-compatible APIs (OpenAI, DeepSeek, Kimi, Z.ai GLM, OpenRouter, Anthropic, Groq, Gemini, xAI, Mistral); key held in memory only, never persisted or broadcast (config exposes `keyHint` masked). Contextual replies: per-chat history (capped 20 entries / 500 chats) plus the exact campaign message sent to each contact are injected into the prompt, alongside an optional user-provided `businessContext`. Outgoing campaign and manual sends are fed via `autoreplyService.noteOutgoingMessage()` from `main.js`.
- `src/license-service.js` — simple VIP license state
- `src/utils.js` — phone number parsing and delay helpers
- `renderer/` — static frontend (HTML/CSS/JS)
- `scripts/pair-and-send.js` — CLI helper: pair a number and send a test message

## Multi-Account Model

- Each account id is the `LocalAuth` clientId → session stored in `.wwebjs_auth/session-<id>`.
- `accounts.json` persists accounts, active id, per-account `proxy`, and sent/failed stats.
- Account switching is manual by default and blocked while a campaign runs.
- Switching destroys the current browser first (releases the Chromium profile lock); if the target has a session it auto-restores, otherwise the user links via QR/pairing.
- Optional campaign rotation (panel: Accounts → Account Rotation, `campaign:set-rotation`): when enabled, `campaign-service` switches to the next linked account (round-robin over `account-manager.listLinked()`) after `maxPerAccount` sends, waits `switchPauseSeconds` first, and stops the campaign with an error if no linked account connects. Only the single live browser is reused — rotation is destroy → setActive → initialize → wait for ready.

## Conventions

- CommonJS modules
- 2-space indentation
- Minimal changes; keep code simple and modular
- Use Socket.IO events prefixed by domain (`whatsapp:`, `campaign:`, `numbers:`, etc.)

## Security Notes

- The dashboard binds to `127.0.0.1` by default (`HOST` env overrides; a warning prints when exposed). Socket.IO caps payloads at 1 MB.
- HTTP responses carry nosniff / DENY-framing / no-referrer / CSP headers; `express.json` is capped at 256 KB; `x-powered-by` is off.
- Socket input is clamped: campaign message 4 096 chars, number list 10 000 entries, delays ≤ 3600 s, account labels 60 chars, proxy strings 2 048 chars; model ids must match a strict pattern.
- AI API keys live in server memory only — never written to disk, never broadcast; clients see a masked `keyHint`, and error messages are scrubbed before emission.

## Environment Variables

- `PORT` — server port (default 3000)
- `PUPPETEER_EXECUTABLE_PATH` — path to system Chromium (default `/usr/bin/chromium`)
- `WWEBJS_WEB_VERSION` — pinned WhatsApp Web HTML version
- `WWEBJS_AUTH_TIMEOUT` — ms to wait for the WhatsApp auth store to boot (default 120000; needed higher than the library's 30s default when using proxies)

## Proxy Handling

- Proxies are per account ("1 number = 1 proxy"): `account-manager.setProxy(id, proxy)` validates and persists on the account; the panel's proxy field edits the active account's.
- The account's proxy is applied on every connection path — connect, pairing, manual switch, and rotation — via `whatsappClient.setProxy(account.proxy || null)` before `initialize` (wrapper stores it as "proxy for next connection").
- Proxies are passed to Chromium as `--proxy-server=<scheme>//<host>:<port>` only — never include a path or trailing slash, Chromium silently ignores the proxy otherwise.
- Authenticated proxies (`user:pass@host:port`) are forwarded through a local `proxy-chain` anonymized proxy and closed on disconnect.
- On failed initialization the wrapper destroys the browser so the profile dir lock is released, and saves a diagnostic screenshot to `.wwebjs_debug/init-failure.png`.
