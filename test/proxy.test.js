const assert = require('assert');
const { describe, it } = require('node:test');
const { parseProxyUrl } = require('../src/utils');

describe('parseProxyUrl', () => {
  it('parses bare host:port', () => {
    const url = parseProxyUrl('45.12.30.22:8080');
    assert.ok(url);
    assert.strictEqual(url.hostname, '45.12.30.22');
    assert.strictEqual(url.port, '8080');
    assert.strictEqual(url.protocol, 'http:');
  });

  it('parses http proxy with credentials', () => {
    const url = parseProxyUrl('http://user:pass@proxy.io:8000');
    assert.ok(url);
    assert.strictEqual(url.hostname, 'proxy.io');
    assert.strictEqual(url.port, '8000');
    assert.strictEqual(url.username, 'user');
    assert.strictEqual(url.password, 'pass');
  });

  it('parses socks5 proxy', () => {
    const url = parseProxyUrl('socks5://10.0.0.1:1080');
    assert.ok(url);
    assert.strictEqual(url.protocol, 'socks5:');
  });

  it('returns null for invalid input', () => {
    assert.strictEqual(parseProxyUrl(''), null);
    assert.strictEqual(parseProxyUrl(null), null);
    assert.strictEqual(parseProxyUrl('no-port-here'), null);
    assert.strictEqual(parseProxyUrl('host:99999'), null);
    assert.strictEqual(parseProxyUrl('host:abc'), null);
  });
});
