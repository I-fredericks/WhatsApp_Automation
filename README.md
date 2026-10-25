# WhatsApp Bulk Campaign Tool v1

A web-based WhatsApp automation tool for running bulk messaging campaigns with anti-ban delays and optional AI-powered auto-reply.

## Features

1. **Bulk Number Import** — Upload a `.txt` file with one phone number per line.
2. **Bulk Campaign Messaging** — Draft a campaign message and send it to the entire imported list.
3. **AI-Powered Auto-Reply** — Optional OpenAI integration to auto-respond to incoming replies.
4. **Anti-Ban Protection** — Randomized delay between messages (default 120–240s).
5. **License Management** — VIP activation status displayed in the header.
6. **Execution & Status Tracking** — Start/stop controls with real-time progress and status bar.

## Tech Stack

- Node.js
- Express + Socket.IO (real-time dashboard)
- whatsapp-web.js (WhatsApp Web automation)
- OpenAI API (optional auto-reply)
- Puppeteer (via whatsapp-web.js, uses system Chromium)

## Requirements

- Node.js v18+
- Chromium / Google Chrome installed on the system
- WhatsApp account with WhatsApp Web support
- OpenAI API key (only if using auto-reply)

## Installation

```bash
npm install
```

If Puppeteer fails to download a browser, the project is configured to use the system Chromium at `/usr/bin/chromium`. You can override the path with the environment variable:

```bash
export PUPPETEER_EXECUTABLE_PATH=/path/to/chromium
```

If WhatsApp Web changes and the client fails to initialize, you can pin a different web version:

```bash
export WWEBJS_WEB_VERSION=2.3000.1051617046-alpha
```

If WhatsApp's auth screen takes long to load (common through slow proxies), you can raise the auth timeout (default 120000 ms):

```bash
export WWEBJS_AUTH_TIMEOUT=180000
```

## Proxy Support

You can route the WhatsApp Web session through a proxy:

- In the dashboard: enter the proxy under **Proxy Server** and click **Set Proxy** (applies to the next connection).
- Supported formats: `host:port`, `http://host:port`, `http://user:pass@host:port`, `socks5://host:port`.

Proxies with username/password are handled automatically via a local forwarding proxy (`proxy-chain`), since Chromium does not support proxy authentication prompts.

Notes:
- The proxy applies when you connect; changing it while connected requires a reconnect.
- Use residential/mobile proxies, not datacenter ones, to reduce block risk.
- A debug screenshot of the last failed connection is saved to `.wwebjs_debug/init-failure.png` to help diagnose proxy/connect problems.

## Multi-Account Support

The **WhatsApp Accounts** panel lets you link several numbers:

- **Add Account** creates a new account entry with its own isolated browser session.
- Select an account in the dropdown and press **Switch To**:
  - If the account already has a linked session, it restores automatically (no re-scan).
  - If not, connect it with QR or pairing code.
- Per-account **Sent/Failed** counters are tracked in `accounts.json`.
- **Remove** deletes the account and its stored session files.

Switching accounts is always a manual decision — the tool does not rotate senders automatically. Run only one account's browser at a time.

## Logout & Reset

**Logout & Reset** invalidates the WhatsApp session server-side and deletes the local session files, so the next connect requires a fresh QR scan or pairing code — useful when rotating numbers.

## Usage

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

1. Connect WhatsApp:
   - Click **Connect with QR** and scan the QR code, or
   - Enter your phone number and click **Get Pairing Code**, then enter the code inside WhatsApp on your phone.
2. Import a `.txt` file containing target phone numbers and/or add numbers manually.
3. Enter and save your campaign message.
4. (Optional) Enable AI auto-reply and enter your OpenAI API key.
5. Adjust anti-ban delay settings if needed.
6. Click **Start Bot** to begin the campaign.

## Phone Number Format

Numbers must be in international format without the `+` symbol or `@c.us` suffix, one per line. Example:

```text
905551234567
905559876543
14155551234
```

## Important Notes

- Bulk messaging may violate WhatsApp's Terms of Service. Use responsibly and only with recipients who have consented.
- Anti-ban delays reduce but do not eliminate the risk of account restrictions.
- Store your OpenAI API key securely and do not commit it.

## License

MIT
