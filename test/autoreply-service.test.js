const assert = require('assert');
const { describe, it, beforeEach } = require('node:test');
const { EventEmitter } = require('events');
const AutoReplyService = require('../src/autoreply-service');

class FakeWhatsAppClient extends EventEmitter {}

function makeIncomingMessage(overrides = {}) {
  return {
    from: '905551111111@c.us',
    fromMe: false,
    body: 'hello',
    reply: async () => {},
    ...overrides,
  };
}

describe('AutoReplyService', () => {
  let client;
  let service;

  beforeEach(() => {
    client = new FakeWhatsAppClient();
    service = new AutoReplyService(client);
  });

  it('exposes a provider catalog with the famous models', () => {
    const providers = AutoReplyService.getProviders();
    for (const id of ['openai', 'deepseek', 'kimi', 'zai', 'openrouter', 'anthropic', 'groq', 'gemini', 'xai', 'mistral']) {
      assert.ok(providers[id], `missing provider ${id}`);
      assert.ok(providers[id].models.length > 0);
    }
  });

  it('rejects unknown providers and invalid models', () => {
    assert.strictEqual(service.configure({ enabled: true, provider: 'nope', apiKey: 'sk-test-12345678', model: 'gpt-4o-mini' }).success, false);
    assert.strictEqual(service.configure({ enabled: true, provider: 'openai', apiKey: 'sk-test-12345678', model: 'bad model!' }).success, false);
  });

  it('requires an API key when enabling a provider for the first time', () => {
    const result = service.configure({ enabled: true, provider: 'deepseek', model: 'deepseek-chat' });
    assert.strictEqual(result.success, false);
    assert.match(result.error, /API key/);
  });

  it('masks the API key in config and never exposes the raw key', () => {
    service.configure({ enabled: true, provider: 'openai', apiKey: 'sk-verysecretkey123456', model: 'gpt-4o-mini' });
    const config = service.getConfig();
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.keyHint, 'sk-…3456');
    assert.ok(!JSON.stringify(config).includes('verysecret'));
  });

  it('keeps the stored key when the same provider is reconfigured without a key', () => {
    service.configure({ enabled: true, provider: 'deepseek', apiKey: 'ds-key-1234567890', model: 'deepseek-chat' });
    const result = service.configure({ enabled: true, provider: 'deepseek', model: 'deepseek-reasoner' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(service.getConfig().model, 'deepseek-reasoner');
    assert.strictEqual(service.getConfig().keyHint, 'ds-…7890');
  });

  it('demands a new key when switching provider without one', () => {
    service.configure({ enabled: true, provider: 'deepseek', apiKey: 'ds-key-1234567890', model: 'deepseek-chat' });
    const result = service.configure({ enabled: true, provider: 'openai', model: 'gpt-4o-mini' });
    assert.strictEqual(result.success, false);
    assert.match(result.error, /API key/);
  });

  it('replies to an incoming private message through the configured provider', async () => {
    service.configure({ enabled: true, provider: 'zai', apiKey: 'zai-key-1234567890', model: 'glm-4.5-flash' });
    service._openai = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: '  Hi! How can I help? ' } }],
          }),
        },
      },
    };
    let sent;
    const msg = makeIncomingMessage({ reply: async (text) => { sent = text; } });
    let repliedTo = null;
    service.on('replied', ({ to }) => { repliedTo = to; });

    service.start();
    client.emit('message', msg);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.strictEqual(sent, 'Hi! How can I help?');
    assert.strictEqual(repliedTo, '905551111111@c.us');
  });

  it('ignores own messages, groups, and rapid repeat messages', async () => {
    let calls = 0;
    service.configure({ enabled: true, provider: 'openai', apiKey: 'sk-test-12345678', model: 'gpt-4o-mini' });
    service._openai = {
      chat: { completions: { create: async () => { calls += 1; return { choices: [{ message: { content: 'x' } }] }; } } },
    };
    const replies = [];
    const msg = makeIncomingMessage({ reply: async (text) => replies.push(text) });

    service.start();
    client.emit('message', makeIncomingMessage({ fromMe: true }));
    client.emit('message', makeIncomingMessage({ from: '555@g.us' }));
    client.emit('message', msg);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.strictEqual(calls, 1);

    // Same chat again inside the cooldown window: skipped.
    client.emit('message', makeIncomingMessage());
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.strictEqual(calls, 1);
    assert.strictEqual(replies.length, 1);
  });

  it('does not leak the API key in error events', async () => {
    service.configure({ enabled: true, provider: 'openai', apiKey: 'sk-supersecret99', model: 'gpt-4o-mini' });
    service._openai = {
      chat: {
        completions: {
          create: async () => {
            const err = new Error('request failed with key sk-supersecret99 in url');
            throw err;
          },
        },
      },
    };
    const errors = [];
    service.on('error', (msg) => errors.push(msg));

    service.start();
    client.emit('message', makeIncomingMessage());
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.strictEqual(errors.length, 1);
    assert.ok(!errors[0].includes('sk-supersecret99'));
    assert.ok(errors[0].includes('***'));
  });
});
