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

## Usage

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

1. Click **Connect WhatsApp** and scan the QR code with your phone.
2. Import a `.txt` file containing target phone numbers.
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
