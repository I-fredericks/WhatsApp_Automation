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
});
