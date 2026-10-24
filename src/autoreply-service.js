/**
 * AI-powered auto-reply service using the OpenAI API.
 * Listens to incoming WhatsApp messages and replies when enabled.
 */

const { EventEmitter } = require('events');
const OpenAI = require('openai');

class AutoReplyService extends EventEmitter {
  constructor(whatsappClient) {
    super();
    this.whatsappClient = whatsappClient;
    this._enabled = false;
    this._apiKey = null;
    this._model = 'gpt-4o-mini';
    this._systemPrompt =
      'You are a helpful assistant replying to WhatsApp messages on behalf of a business. Keep replies concise, friendly, and relevant.';
    this._openai = null;
    this._handler = null;
  }

  /**
   * Configure the auto-reply service.
   * @param {{enabled: boolean, apiKey: string, model?: string, systemPrompt?: string}} options
   */
  configure(options) {
    this._enabled = Boolean(options.enabled);
    this._apiKey = options.apiKey || null;
    this._model = options.model || this._model;
    this._systemPrompt = options.systemPrompt || this._systemPrompt;

    if (this._enabled && this._apiKey) {
      this._openai = new OpenAI({ apiKey: this._apiKey });
    } else {
      this._openai = null;
    }
  }

  /**
   * @returns {{enabled: boolean, model: string}}
   */
  getConfig() {
    return {
      enabled: this._enabled,
      model: this._model,
    };
  }

  /**
   * Start listening for incoming messages.
   */
  start() {
    if (this._handler) {
      return;
    }
    this._handler = async (msg) => {
      if (!this._enabled || !this._openai) {
        return;
      }
      // Ignore messages sent by ourselves.
      if (msg.fromMe) {
        return;
      }
      // Only handle private chats.
      if (!msg.from || !msg.from.endsWith('@c.us')) {
        return;
      }

      try {
        this.emit('status', `AI auto-reply thinking for ${msg.from}...`);
        const completion = await this._openai.chat.completions.create({
          model: this._model,
          messages: [
            { role: 'system', content: this._systemPrompt },
            { role: 'user', content: msg.body || '' },
          ],
          max_tokens: 300,
          temperature: 0.7,
        });

        const reply = completion.choices[0]?.message?.content?.trim();
        if (reply) {
          await msg.reply(reply);
          this.emit('replied', { to: msg.from, reply });
        }
      } catch (err) {
        this.emit('error', `Auto-reply failed: ${err.message}`);
      }
    };

    this.whatsappClient.on('message', this._handler);
  }

  /**
   * Stop listening for incoming messages.
   */
  stop() {
    if (this._handler) {
      this.whatsappClient.off('message', this._handler);
      this._handler = null;
    }
  }
}

module.exports = AutoReplyService;
