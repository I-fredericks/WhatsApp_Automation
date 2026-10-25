/**
 * AI-powered auto-reply service.
 *
 * Uses the OpenAI-compatible chat completions API, so most major providers
 * (OpenAI, DeepSeek, Moonshot Kimi, Z.ai GLM, OpenRouter, Anthropic Claude,
 * Groq, Google Gemini, xAI Grok, Mistral) work through the same client with
 * a different baseURL. The API key is held in memory only and never
 * persisted or broadcast to clients (config exposes a masked hint instead).
 */

const { EventEmitter } = require('events');
const OpenAI = require('openai');

const SYSTEM_PROMPT =
  'You are a helpful assistant replying to WhatsApp messages on behalf of a business. Keep replies concise, friendly, and relevant.';

const PROVIDERS = {
  openai: {
    label: 'OpenAI (ChatGPT)',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'],
  },
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  kimi: {
    label: 'Moonshot Kimi',
    baseURL: 'https://api.moonshot.ai/v1',
    models: ['kimi-k2-turbo-preview', 'kimi-k2-instruct', 'moonshot-v1-8k', 'moonshot-v1-32k'],
  },
  zai: {
    label: 'Z.ai (GLM)',
    baseURL: 'https://api.z.ai/api/paas/v4',
    models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air', 'glm-4.5-flash'],
  },
  openrouter: {
    label: 'OpenRouter (Claude, GPT, Gemini, Llama...)',
    baseURL: 'https://openrouter.ai/api/v1',
    models: [
      'anthropic/claude-sonnet-4',
      'anthropic/claude-3.5-haiku',
      'openai/gpt-4o-mini',
      'google/gemini-2.0-flash-001',
      'deepseek/deepseek-chat-v3-0324',
      'meta-llama/llama-3.3-70b-instruct',
    ],
  },
  anthropic: {
    label: 'Anthropic Claude (direct)',
    baseURL: 'https://api.anthropic.com/v1',
    defaultHeaders: { 'anthropic-version': '2023-06-01' },
    models: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
  },
  groq: {
    label: 'Groq (Llama, Gemma)',
    baseURL: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'],
  },
  gemini: {
    label: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'],
  },
  xai: {
    label: 'xAI Grok',
    baseURL: 'https://api.x.ai/v1',
    models: ['grok-4', 'grok-3-mini', 'grok-2-1212'],
  },
  mistral: {
    label: 'Mistral AI',
    baseURL: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-small-latest', 'open-mistral-nemo'],
  },
};

const MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,120}$/;
const KEY_PATTERN = /^[A-Za-z0-9._~+/=-]{8,256}$/;
const MAX_INCOMING_CHARS = 2000;
const REPLY_COOLDOWN_MS = 2000;

class AutoReplyService extends EventEmitter {
  constructor(whatsappClient) {
    super();
    this.whatsappClient = whatsappClient;
    this._enabled = false;
    this._provider = 'openai';
    this._apiKey = null;
    this._model = 'gpt-4o-mini';
    this._systemPrompt = SYSTEM_PROMPT;
    this._openai = null;
    this._handler = null;
    this._lastReplyAt = new Map();
  }

  /**
   * Provider catalog for the UI (no secrets).
   * @returns {object} { id: { label, models } }
   */
  static getProviders() {
    return Object.fromEntries(
      Object.entries(PROVIDERS).map(([id, p]) => [id, { label: p.label, models: [...p.models] }]),
    );
  }

  /**
   * Masked key for display, e.g. "sk-…ab12". Safe to broadcast.
   * @param {string|null} key
   * @returns {string|null}
   */
  static maskKey(key) {
    if (!key || key.length < 8) {
      return null;
    }
    return `${key.slice(0, 3)}…${key.slice(-4)}`;
  }

  /**
   * Configure the auto-reply service.
   * @param {{enabled: boolean, provider?: string, apiKey?: string, model?: string, systemPrompt?: string}} options
   * @returns {{success: boolean, error?: string, config?: object}}
   */
  configure(options = {}) {
    const enabled = Boolean(options.enabled);
    const provider = String(options.provider || this._provider || 'openai').trim();
    if (!Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) {
      return { success: false, error: 'Unknown AI provider.' };
    }

    const model = String(options.model || this._model).trim();
    if (!MODEL_PATTERN.test(model)) {
      return { success: false, error: 'Invalid model name.' };
    }

    const rawKey = options.apiKey ? String(options.apiKey).trim() : '';
    if (rawKey && !KEY_PATTERN.test(rawKey)) {
      return { success: false, error: 'API key format looks invalid.' };
    }

    const providerChanged = provider !== this._provider;
    // An empty key keeps the stored one, but only for the same provider —
    // keys are never valid across providers.
    const apiKey = rawKey || (providerChanged ? null : this._apiKey);
    if (enabled && !apiKey) {
      return { success: false, error: `Enter the API key for ${PROVIDERS[provider].label}.` };
    }

    this._enabled = enabled;
    this._provider = provider;
    this._apiKey = apiKey || null;
    this._model = model;
    if (options.systemPrompt && typeof options.systemPrompt === 'string') {
      this._systemPrompt = options.systemPrompt.slice(0, 2000);
    }

    if (this._enabled && this._apiKey) {
      const cfg = PROVIDERS[provider];
      this._openai = new OpenAI({
        apiKey: this._apiKey,
        baseURL: cfg.baseURL,
        ...(cfg.defaultHeaders ? { defaultHeaders: cfg.defaultHeaders } : {}),
      });
    } else {
      this._openai = null;
    }

    return { success: true, config: this.getConfig() };
  }

  /**
   * Current state. Never includes the raw API key.
   * @returns {{enabled: boolean, provider: string, model: string, keyHint: string|null}}
   */
  getConfig() {
    return {
      enabled: this._enabled,
      provider: this._provider,
      model: this._model,
      keyHint: AutoReplyService.maskKey(this._apiKey),
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
      // Ignore messages sent by ourselves and group chats.
      if (msg.fromMe || !msg.from || !msg.from.endsWith('@c.us')) {
        return;
      }
      // Cooldown per chat so two bots cannot loop each other and drain
      // API credits.
      const now = Date.now();
      const last = this._lastReplyAt.get(msg.from) || 0;
      if (now - last < REPLY_COOLDOWN_MS) {
        return;
      }
      this._lastReplyAt.set(msg.from, now);

      try {
        this.emit('status', `AI auto-reply thinking for ${msg.from}...`);
        const completion = await this._openai.chat.completions.create({
          model: this._model,
          messages: [
            { role: 'system', content: this._systemPrompt },
            { role: 'user', content: String(msg.body || '').slice(0, MAX_INCOMING_CHARS) },
          ],
          max_tokens: 300,
          temperature: 0.7,
        });

        const reply = completion.choices[0]?.message?.content?.trim().slice(0, 1000);
        if (reply) {
          await msg.reply(reply);
          this.emit('replied', { to: msg.from, reply });
        }
      } catch (err) {
        // Never echo the API key back in error messages.
        const detail = this._apiKey
          ? String(err.message || 'unknown error').split(this._apiKey).join('***')
          : String(err.message || 'unknown error');
        this.emit('error', `Auto-reply failed: ${detail}`);
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
