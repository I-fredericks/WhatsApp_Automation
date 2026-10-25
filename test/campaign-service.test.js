const assert = require('assert');
const { describe, it } = require('node:test');
const CampaignService = require('../src/campaign-service');
const { EventEmitter } = require('events');

class FakeWhatsAppClient extends EventEmitter {
  constructor() {
    super();
    this._ready = true;
    this.sent = [];
  }
  isReady() {
    return this._ready;
  }
  async sendMessage(number, text) {
    this.sent.push({ number, text });
  }
}

describe('CampaignService', () => {
  it('sends messages to all numbers', async () => {
    const client = new FakeWhatsAppClient();
    const service = new CampaignService(client);
    const numbers = ['905551111111', '905552222222'];

    const finishedPromise = new Promise((resolve) => {
      service.on('finished', resolve);
    });

    // Use tiny delays for testing
    service.start(numbers, 'Hello!', { minDelay: 0, maxDelay: 0 });

    const stats = await finishedPromise;
    assert.strictEqual(stats.total, 2);
    assert.strictEqual(stats.sent, 2);
    assert.strictEqual(stats.failed, 0);
    assert.strictEqual(client.sent.length, 2);
  });

  it('counts failures when sending fails', async () => {
    const client = new FakeWhatsAppClient();
    client.sendMessage = async () => {
      throw new Error('blocked');
    };
    const service = new CampaignService(client);

    const finishedPromise = new Promise((resolve) => {
      service.on('finished', resolve);
    });

    service.start(['905551111111'], 'Hi', { minDelay: 0, maxDelay: 0 });
    const stats = await finishedPromise;
    assert.strictEqual(stats.sent, 0);
    assert.strictEqual(stats.failed, 1);
  });

  it('rotates accounts after the configured per-account limit', async () => {
    const client = new FakeWhatsAppClient();
    const service = new CampaignService(client);
    const numbers = ['905551111111', '905552222222', '905553333333', '905554444444'];
    let rotations = 0;

    const finishedPromise = new Promise((resolve) => {
      service.on('finished', resolve);
    });

    await service.start(
      numbers,
      'Hi',
      { minDelay: 0, maxDelay: 0 },
      { enabled: true, maxPerAccount: 2, switchPauseSeconds: 0 },
      async () => {
        rotations += 1;
      },
    );
    await finishedPromise;

    // Limit of 2 hit after message 2 (rotation), then messages 3 and 4
    // follow; no rotation after the final message.
    assert.strictEqual(rotations, 1);
    assert.strictEqual(client.sent.length, 4);
  });

  it('does not rotate when rotation is disabled', async () => {
    const client = new FakeWhatsAppClient();
    const service = new CampaignService(client);
    const numbers = ['905551111111', '905552222222', '905553333333'];

    await service.start(
      numbers,
      'Hi',
      { minDelay: 0, maxDelay: 0 },
      { enabled: false, maxPerAccount: 1, switchPauseSeconds: 0 },
      async () => {
        throw new Error('must not be called');
      },
    );
    assert.strictEqual(client.sent.length, 3);
  });

  it('stops the campaign when rotation fails', async () => {
    const client = new FakeWhatsAppClient();
    const service = new CampaignService(client);
    const numbers = ['905551111111', '905552222222', '905553333333'];
    const errors = [];

    service.on('error', (msg) => errors.push(msg));

    await service.start(
      numbers,
      'Hi',
      { minDelay: 0, maxDelay: 0 },
      { enabled: true, maxPerAccount: 1, switchPauseSeconds: 0 },
      async () => {
        throw new Error('no linked account');
      },
    );

    // First message sent, rotation failed, remaining numbers skipped.
    assert.strictEqual(client.sent.length, 1);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /Account rotation failed/);
  });
});
