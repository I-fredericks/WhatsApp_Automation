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

  describe('campaign context', () => {
    it('includes the campaign message and business info in the prompt', async () => {
      service.configure({
        enabled: true,
        provider: 'openai',
        apiKey: 'sk-test-12345678',
        model: 'gpt-4o-mini',
        businessContext: 'We sell coffee subscriptions. Price is 10 USD/month.',
      });
      service.noteOutgoingMessage('905551111111', 'Special offer: 50% off coffee this week!', 'campaign');
      service._openai = {
        chat: {
          completions: {
            create: async (params) => {
              service._lastPrompt = params.messages;
              return { choices: [{ message: { content: 'Yes, the offer applies!' } }] };
            },
          },
        },
      };

      service.start();
      client.emit('message', makeIncomingMessage({ body: 'Does the offer still work?' }));
      await new Promise((resolve) => setTimeout(resolve, 10));

      const messages = service._lastPrompt;
      const system = messages.find((m) => m.role === 'system');
      assert.ok(system.content.includes('coffee subscriptions'));
      assert.ok(system.content.includes('Special offer: 50% off coffee this week!'));
      const roles = messages.map((m) => m.role);
      assert.deepStrictEqual(roles, ['system', 'assistant', 'user']);
      assert.strictEqual(messages[1].content, 'Special offer: 50% off coffee this week!');
      assert.strictEqual(messages[2].content, 'Does the offer still work?');
    });

    it('matches @c.us JIDs to campaign numbers by digits', () => {
      service.noteOutgoingMessage('905551111111', 'Campaign X', 'campaign');
      assert.strictEqual(service._campaignByChat.get('905551111111'), 'Campaign X');
      assert.ok(AutoReplyService.chatKey('+90 555 111 11 11@c.us'.replace('@c.us', '')) === '905551111111');
    });

    it('keeps conversation history across replies', async () => {
      service.configure({ enabled: true, provider: 'openai', apiKey: 'sk-test-12345678', model: 'gpt-4o-mini' });
      const answers = ['First reply', 'Second reply'];
      service._openai = {
        chat: {
          completions: {
            create: async (params) => {
              service._lastPrompt = params.messages;
              return { choices: [{ message: { content: answers.shift() } }] };
            },
          },
        },
      };

      service.start();
      client.emit('message', makeIncomingMessage({ body: 'first question' }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      // second message after cooldown
      service._lastReplyAt.set('905551111111@c.us', 0);
      client.emit('message', makeIncomingMessage({ body: 'second question' }));
      await new Promise((resolve) => setTimeout(resolve, 10));

      const messages = service._lastPrompt;
      const roles = messages.map((m) => m.role);
      assert.deepStrictEqual(roles, ['system', 'user', 'assistant', 'user']);
      assert.strictEqual(messages[2].content, 'First reply');
      assert.strictEqual(messages[3].content, 'second question');
    });

    it('caps history per chat', async () => {
      service.configure({ enabled: true, provider: 'openai', apiKey: 'sk-test-12345678', model: 'gpt-4o-mini' });
      for (let i = 0; i < 30; i++) {
        service._pushHistory('900000000000', { role: 'user', content: 'msg ' + i });
      }
      const history = service._history.get('900000000000');
      assert.ok(history.length <= 20, `history length ${history.length} should be capped`);
      assert.strictEqual(history[history.length - 1].content, 'msg 29');
    });

    it('round-trips businessContext through config', () => {
      const result = service.configure({
        enabled: false,
        provider: 'openai',
        model: 'gpt-4o-mini',
        businessContext: ' Bakery shop. Open 9-5. ',
      });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.config.businessContext, 'Bakery shop. Open 9-5.');
    });
  });
});
